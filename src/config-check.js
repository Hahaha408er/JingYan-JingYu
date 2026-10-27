

import fs from 'node:fs';
import path from 'node:path';

const FEATURE_KEYS = [
  'memory', 'stickers', 'gallery', 'diary', 'voice', 'proactive',
  'listen', 'phone', 'profile', 'mood', 'life',
];

function asQq(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{5,12}$/.test(s) ? s : null;
}

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function quietNote(q) {
  if (!Array.isArray(q)) return 'quiet 必须是 [开始小时, 结束小时] 两个整数';
  if (q.length !== 2) return 'quiet 必须是两个整数小时（现在是 ' + q.length + ' 个）';
  const [a, b] = q.map(num);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return 'quiet 必须是两个整数小时';
  if (a < 0 || a > 23 || b < 0 || b > 24) return 'quiet 的小时要在 0~24 之间';
  if (a === b) return 'quiet 首尾相同，等于一直不发';
  return null;
}

export function checkConfig(cfg = {}, opts = {}) {
  const log = opts.log || console;
  const root = opts.root || '';
  const fatal = [];
  const warn = [];
  const fixed = [];

  if (!Array.isArray(cfg.ownerIds) || !cfg.ownerIds.length) {
    fatal.push('ownerIds 是空的 → 没人能叫醒她，主动找你也没有对象');
  } else {
    const cleaned = [];
    for (const raw of cfg.ownerIds) {
      const qq = asQq(raw);
      if (!qq) { warn.push('ownerIds 里有不像 QQ 号的值：' + JSON.stringify(raw) + '（已忽略）'); continue; }
      if (typeof raw !== 'string') fixed.push('ownerIds 里的数字 ' + raw + ' 改成了字符串');
      cleaned.push(qq);
    }
    if (!cleaned.length) fatal.push('ownerIds 里没有一个是有效 QQ 号');
    if (cleaned.join(',') !== (cfg.ownerIds || []).join(',')) cfg.ownerIds = cleaned;
    if (cleaned.length > 3) warn.push('ownerIds 配了 ' + cleaned.length + ' 个，建议不超过 3 个（再多就分不清"他是谁"了）');
  }

  const ob = cfg.onebot || {};
  for (const [k, label] of [['wsUrl', 'wsUrl'], ['httpUrl', 'httpUrl']]) {
    const u = String(ob[k] || '');
    if (!u) fatal.push('onebot.' + label + ' 是空的 → 连不上 NapCat');
    else if (!/^(wss?|https?):\/\//.test(u)) fatal.push('onebot.' + label + ' 必须以 ws:// 或 http:// 开头，现在是：' + u);
    const m = u.match(/:(\d{2,5})\b/);
    if (m) {
      const p = Number(m[1]);
      if (p < 1 || p > 65535) fatal.push('onebot.' + label + ' 端口不合法：' + p);
    }
  }
  if (!String(ob.accessToken || '').trim()) warn.push('onebot.accessToken 是空的（NapCat 那边如果开了鉴权就会连不上）');

  if (!String(cfg.apiKey || '').trim()) fatal.push('apiKey 是空的 → 她一句话都说不出来');
  if (!String(cfg.model || '').trim()) warn.push('model 是空的，会用默认模型');
  if (!/^https?:\/\//.test(String(cfg.baseUrl || ''))) warn.push('baseUrl 不像一个网址：' + JSON.stringify(cfg.baseUrl));

  const w = cfg.wake || {};
  const p = num(w.probability);
  if (p == null) {
    warn.push('wake.probability 不是数字（' + JSON.stringify(w.probability) + '），按 0 处理');
    w.probability = 0;
  } else {
    if (typeof w.probability !== 'number') fixed.push('wake.probability 从字符串改成了数字 ' + p);
    if (p < 0 || p > 1) warn.push('wake.probability 应该在 0~1 之间，现在是 ' + p + '（1 表示每条群消息都回）');
    w.probability = p;
  }
  if (typeof w.groupAtOnly !== 'boolean') {
    if (w.groupAtOnly != null) fixed.push('wake.groupAtOnly 不是布尔值，按 true（只在群里被 @ 才理）处理');
    w.groupAtOnly = w.groupAtOnly == null ? true : Boolean(w.groupAtOnly);
  }

  if (cfg.groups != null && (typeof cfg.groups !== 'object' || Array.isArray(cfg.groups))) {
    fatal.push('groups 必须是对象，形如 { "群号": { "admins": ["QQ号"] } }');
  } else if (cfg.groups) {
    const clean = {};
    for (const [rawKey, g] of Object.entries(cfg.groups)) {
      const gid = asQq(rawKey);
      if (!gid) {
        warn.push('groups 里的键不像群号：' + JSON.stringify(rawKey) + '（这条配置永远不会生效，已忽略）');
        continue;
      }
      if (!g || typeof g !== 'object') { warn.push('groups["' + gid + '"] 不是对象，已忽略'); continue; }
      const item = { ...g };

      if (item.admins != null) {
        if (!Array.isArray(item.admins)) { warn.push('groups["' + gid + '"].admins 应该是数组，已按单个值处理'); item.admins = [item.admins]; }
        const ok = [];
        for (const a of item.admins) {
          const qq = asQq(a);
          if (qq) ok.push(qq);
          else warn.push('groups["' + gid + '"].admins 里有不像 QQ 号的值：' + JSON.stringify(a) + '（已忽略）');
        }
        item.admins = ok;
      }
      if (item.mode != null && item.mode !== 'diving' && item.mode !== 'active') {
        warn.push('groups["' + gid + '"].mode 只能是 "diving" 或 "active"，现在是 ' + JSON.stringify(item.mode) + '（按 diving 处理）');
        item.mode = 'diving';
      }
      if (item.probability != null) {
        const gp = num(item.probability);
        if (gp == null) { warn.push('groups["' + gid + '"].probability 不是数字，已删掉'); delete item.probability; }
        else {
          if (gp < 0 || gp > 1) warn.push('groups["' + gid + '"].probability 应该在 0~1 之间，现在是 ' + gp);
          item.probability = gp;
        }
      }
      for (const k of ['nameMention', 'question', 'poke', 'allowGallery']) {
        if (item[k] != null && typeof item[k] !== 'boolean') {
          warn.push('groups["' + gid + '"].' + k + ' 应该是 true/false，现在按 ' + Boolean(item[k]) + ' 处理');
          item[k] = Boolean(item[k]);
        }
      }
      clean[gid] = item;
    }
    cfg.groups = clean;
  }

  for (const [label, arr] of [
    ['stickers.quiet', (cfg.stickers || {}).quiet],
    ['voice.quiet', (cfg.voice || {}).quiet],
  ]) {

    if (arr == null) continue;
    if (Array.isArray(arr) && arr.length === 0) continue;
    const note = quietNote(arr);
    if (note) { warn.push(label + '：' + note); continue; }
    if (!Array.isArray(arr) || arr.length !== 2) continue;
    const [a, b] = arr.map(num);
    if (a > b) {

      const span = (24 - a) + b;
      if (span > 12) {
        warn.push(label + ' = [' + a + ', ' + b + '] 会被理解成"从 ' + a + ' 点到次日 ' + b + ' 点"，一共 ' + span
          + ' 小时。如果你想要的是 ' + b + '~' + a + ' 点，请写成 [' + b + ', ' + a + ']');
      }
    }
  }

  const d = cfg.diary || {};
  const s = num(d.windowStartHour);
  const e = num(d.windowEndHour);
  if (s != null && (s < 0 || s > 23)) warn.push('diary.windowStartHour 应该在 0~23');
  if (e != null && (e < 1 || e > 27)) warn.push('diary.windowEndHour 应该在 1~27（26 = 次日 2 点）');
  if (s != null && e != null && e <= s) warn.push('diary.windowEndHour(' + e + ') 必须大于 windowStartHour(' + s + ')，跨夜请写 26 这种大于 24 的值');

  const h = cfg.humanize || {};
  const burst = num(h.burstMax);
  if (burst != null && (burst < 1 || burst > 6)) warn.push('humanize.burstMax 建议 1~6，现在是 ' + burst);
  const mpc = num(h.msPerChar);
  if (mpc != null && (mpc < 20 || mpc > 200)) warn.push('humanize.msPerChar 建议 20~200，现在是 ' + mpc);

  const lf = cfg.lastfm || {};
  if (lf.enabled !== false && (!String(lf.user || '').trim() || !String(lf.apiKey || '').trim())) {
    if (lf.enabled === true) warn.push('lastfm.enabled 是 true，但 user 或 apiKey 没填 → 实时听歌不会工作（分享卡片照旧可用）');
  }

  const ph = num((cfg.phone || {}).port);
  if (ph != null && (ph < 1 || ph > 65535)) fatal.push('phone.port 不合法：' + ph);

  if (root) {
    const f = path.join(root, (cfg.dataDir || 'data'), 'features.json');
    try {
      const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      const seen = new Set();
      for (const plan of Object.values(raw.plans || {})) {
        for (const k of Object.keys(plan || {})) seen.add(k);
      }
      for (const u of Object.values(raw.users || {})) {
        for (const k of Object.keys((u && u.overrides) || {})) seen.add(k);
      }
      for (const k of Object.keys(raw.features || {})) seen.add(k);
      const unknown = [...seen].filter((k) => !FEATURE_KEYS.includes(k));
      if (unknown.length) warn.push('features.json 里有不认识的开关名：' + unknown.join(', ') + '（不会生效，检查是否拼错）');
    } catch {  }
  }

  let tierNote = '';
  if (root) {
    const PRO_MODULES = [
      ['日记', 'diary-bridge.js'],
      ['听歌', 'listening.js'],
      ['语音', 'voice.js'],
      ['手机', 'phone.js'],
      ['月度画像', 'profile.js'],
    ];
    const lacking = PRO_MODULES
      .filter(([, f]) => !fs.existsSync(path.join(root, 'src', f)))
      .map(([n]) => n);
    if (lacking.length) {
      tierNote = '这个安装包不含：' + lacking.join('、') + '，对应的开关会被自动忽略。';
    }
  }

  const tag = '[配置] ';
  if (tierNote) log.log(tag + '档位：' + tierNote);
  if (fixed.length) log.log(tag + '自动修正 ' + fixed.length + ' 处：' + fixed.join('；'));
  if (warn.length) for (const m of warn) log.warn(tag + '⚠️  ' + m);
  if (fatal.length) for (const m of fatal) log.error(tag + '❌  ' + m);
  if (!fatal.length && !warn.length && !fixed.length) log.log(tag + '✅ 没发现问题');

  return { fatal, warn, fixed, tierNote };
}

export default { checkConfig };
