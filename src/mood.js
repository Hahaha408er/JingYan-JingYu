

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  enabled: true,

  energyStart: 74,
  patienceStart: 66,

  energyPerHour: 7,
  patiencePerHour: 5,

  patiencePer100Chars: 2,

  patienceHit: 6,

  patiencePraise: 4,

  dayJitter: 10,
};

const HOSTILE = ['滚', '闭嘴', '烦', '吵', '笨', '傻', '丑', '垃圾', '废物', '没用', '别烦我'];
const PRAISE = ['可爱', '好看', '厉害', '喜欢', '乖', '棒', '漂亮', '聪明', '心疼'];

function baseline(hour) {
  if (hour < 5) return { dEnergy: -22, tone: '困', note: '这个点还没睡，眼睛都快睁不开了' };
  if (hour < 8) return { dEnergy: -12, tone: '迷糊', note: '刚醒没多久，脑子还没转起来' };
  if (hour < 11) return { dEnergy: 2, tone: '清醒', note: '上午，精神还行' };
  if (hour < 14) return { dEnergy: 4, tone: '平常', note: '中午，吃饱了有点懒' };
  if (hour < 16) return { dEnergy: -9, tone: '犯困', note: '下午最困的时候，一直想趴下' };
  if (hour < 19) return { dEnergy: 8, tone: '精神', note: '天开始黑了，反而来劲' };
  if (hour < 23) return { dEnergy: 2, tone: '平常', note: '晚上，正常状态' };
  return { dEnergy: -5, tone: '亢奋', note: '夜深了，越熬越精神' };
}

const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, n));

export function createMood(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const log = cfg.log || console;
  const dir = cfg.dataDir || 'data';
  const file = path.join(dir, 'mood.json');

  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  let state = {
    day: today(),
    energy: cfg.energyStart,
    patience: cfg.patienceStart,

    bias: 0,
    at: Date.now(),
    hits: 0,
    praises: 0,
  };

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') state = { ...state, ...raw };
  } catch {  }

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch (e) { log.warn('[状态] 没写进去：' + (e?.message || e)); }
  }

  function refresh() {
    const now = Date.now();
    const hours = Math.max(0, (now - (state.at || now)) / 3600_000);
    if (hours > 0.05) {
      state.energy = clamp(state.energy + cfg.energyPerHour * hours);
      state.patience = clamp(state.patience + cfg.patiencePerHour * hours);
      state.at = now;
    }
    if (state.day !== today()) {
      const j = Math.round((Math.random() * 2 - 1) * cfg.dayJitter);
      state.day = today();
      state.bias = j;
      state.energy = clamp(cfg.energyStart + j);
      state.patience = clamp(cfg.patienceStart + Math.round(j / 2));
      state.hits = 0;
      state.praises = 0;
      state.at = now;
      save();
    }
    return state;
  }

  function label(e, p) {
    if (p <= 25) return e <= 30 ? '又累又烦' : '有点暴躁';
    if (p <= 45) return '不太耐烦';
    if (e <= 25) return '困得不行';
    if (e <= 45) return '蔫蔫的';
    if (e >= 80 && p >= 70) return '心情不错';
    if (e >= 65) return '还行';
    return '一般般';
  }

  function hint() {
    if (cfg.enabled === false) return '';
    const s = refresh();
    const h = new Date().getHours();
    const b = baseline(h);
    const energy = clamp(s.energy + b.dEnergy);
    const mood = label(energy, s.patience);

    const lines = [
      '【你现在的状态】' + mood + '（精力 ' + Math.round(energy) + '/100，耐心 ' + Math.round(s.patience) + '/100）。'
        + b.note + '。',
    ];
    if (energy <= 30) lines.push('没力气的时候句子要短、别铺陈，能两个字说完就别五个字。');
    else if (s.patience <= 35) lines.push('这会儿容易烦：他要是重复问、说废话，你可以敷衍或者怼回去。');
    else if (energy >= 75 && s.patience >= 65) lines.push('状态好，可以多损他两句、话也敢说长一点。');
    lines.push('别把状态挂嘴上——不许出现"我很累""我心情不好"这种句子，只用语气和句子长短让这件事自然露出来。');
    return lines.join('\n');
  }

  function after(input = {}) {
    if (cfg.enabled === false) return;
    const s = refresh();
    const text = String(input.text || '');
    const out = String(input.out || '');

    s.energy = clamp(s.energy - Math.min(4, (text.length + out.length * 0.5) / 140));
    s.patience = clamp(s.patience - (text.length / 100) * cfg.patiencePer100Chars);

    if (PRAISE.some((w) => text.includes(w))) { s.patience = clamp(s.patience + cfg.patiencePraise); s.praises += 1; }
    if (HOSTILE.some((w) => text.includes(w))) { s.patience = clamp(s.patience - cfg.patienceHit); s.hits += 1; }

    const h = new Date().getHours();
    if (h >= 2 && h < 6) s.energy = clamp(s.energy - 1.5);

    s.at = Date.now();
    save();
  }

  return {
    hint,
    after,

    peek() {
      const s = refresh();
      const b = baseline(new Date().getHours());
      const energy = clamp(s.energy + b.dEnergy);
      return { mood: label(energy, s.patience), energy: Math.round(energy), patience: Math.round(s.patience), day: s.day };
    },
    get enabled() { return cfg.enabled !== false; },
  };
}
