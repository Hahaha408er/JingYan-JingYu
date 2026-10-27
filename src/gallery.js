

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sendImageFile, isImageFile } from './media.js';

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

const SEE_ASK_RE = /(发.{0,3}图|发张|发一张|照片|图库里|你图库|翻.{0,2}那张|给我看.{0,4}图|我看(看|下)?.{0,6}图|那张图|这张图|发我)/;

const DEFAULTS = {
  enabled: true,
  dir: 'data/gallery',
  maxMB: 4,
  collectPerDay: 3,
  perHour: 1,
  perDay: 2,
  mode: 'base64',
  hintMax: 12,
};

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function createGallery(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const dir = path.resolve(cfg.dir);
  const indexFile = path.resolve(cfg.indexFile || path.join(dir, 'index.json'));
  const log = cfg.log || console;

  const say = (s) => {
    try {
      if (typeof log.warn === 'function') log.warn(s);
      else if (typeof log === 'function') log(s);
      else console.log(s);
    } catch {  }
  };

  let cache = null;
  let cacheMtime = -1;
  let sent = [];

  function load() {
    let mtime = -1;
    try {
      mtime = fs.statSync(indexFile).mtimeMs;
    } catch {
      mtime = -1;
    }
    if (cache && mtime === cacheMtime) return cache;
    cacheMtime = mtime;
    if (mtime < 0) {
      cache = { items: [] };
      return cache;
    }
    try {
      const j = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      const items = Array.isArray(j?.items) ? j.items : [];
      cache = {
        items: items
          .filter((it) => it && it.file)
          .map((it) => ({
            file: String(it.file),
            reason: String(it.reason || ''),
            from: String(it.from || ''),
            addedAt: Number(it.addedAt) || 0,
          })),
      };
    } catch (e) {
      log.warn && log.warn('   [图库] index.json 读不动，先当空库：' + (e && e.message));
      cache = { items: [] };
    }
    return cache;
  }

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(indexFile, JSON.stringify({ items: load().items }, null, 2), 'utf8');
      cacheMtime = fs.statSync(indexFile).mtimeMs;
      return true;
    } catch (e) {
      log.warn && log.warn('   [图库] 写索引失败：' + (e && e.message));
      return false;
    }
  }

  function abs(file) {
    return path.join(dir, file);
  }

  function count() {
    return load().items.length;
  }

  function hint(userText) {
    if (!cfg.enabled) return '';
    const items = load().items;
    const lines = [];
    lines.push('【你的图库】');
    if (!items.length) {
      lines.push('还是空的。他发来图、你觉得这张值得留着，就把它收进来（写法见下）。');
    } else {
      lines.push('这些是你自己攒下的图，每张后面是你当初记的理由：');
      const show = items.slice(-cfg.hintMax).reverse();
      show.forEach((it, i) => {
        lines.push('  ' + (i + 1) + '. ' + it.file + (it.reason ? ' —— ' + it.reason : ''));
      });
    }

    if (items.length && SEE_ASK_RE.test(String(userText || ''))) {
      lines.unshift('【他要看图】他这句话是要你从图库发图。你这一条回复里必须包含 [[图库:关键词]]，'
        + '关键词从上面列表的理由里挑两三个字（比如理由「趴草地里睡觉还带心」→ 写 [[图库:趴草地]]）。'
        + '不许只描述画面、不许嘴上说"发了"却不写标记——不写标记他那边什么也收不到。');
    }
    lines.push('想给他看哪张：在回复最后写 [[图库:理由里的几个字]]（不写关键字就随便挑一张）。');
    lines.push('他发来一张图，收不收你自己定——不用等他说「留着」。想留就写 [[收藏:理由]]。');

    const usedToday = collectedToday();
    const left = Math.max(0, cfg.collectPerDay - usedToday);
    if (left > 0) {
      lines.push('今天还能收 ' + left + ' 张（收够了就不再收，明天重新算）。挑着收，别见一张收一张。');
    } else {
      lines.push('今天已经收满 ' + cfg.collectPerDay + ' 张了，他再发图你也收不进去了——只能夸，明天再说。别答应他"我收下了"。');
    }
    lines.push('理由只有一个用处：以后你按它把图找出来。所以要写「这张图里是什么 + 什么场合值得翻出来」，');
    lines.push('比如「他火了，说谁再催就删库」「他半夜发来的猫」「他第一次夸我」。');
    lines.push('别写「好看」「不错」「挑对了」这种评价——将来你自己都搜不到。20 字以内。');
    lines.push('这两个标记程序会拿走，不会出现在消息里。');
    return lines.join('\n');
  }

  function collectedToday() {
    const today = dayKey();
    return load().items.filter((it) => it.addedAt && dayKey(it.addedAt) === today).length;
  }

  function collect({ srcPath, reason = '', from = '' } = {}) {
    if (!cfg.enabled) return null;
    if (!srcPath || !isImageFile(srcPath)) return null;

    let st;
    try {
      st = fs.statSync(srcPath);
    } catch {
      return null;
    }
    if (st.size <= 0 || st.size > cfg.maxMB * 1024 * 1024) {
      log.warn && log.warn('   [图库] 这张太大（' + Math.round(st.size / 1024) + 'KB），不收了');
      return null;
    }

    const ext = path.extname(srcPath).toLowerCase() || '.jpg';
    if (!IMG_EXT.has(ext)) return null;

    let buf;
    try {
      buf = fs.readFileSync(srcPath);
    } catch {
      return null;
    }
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const file = hash + ext;

    const items = load().items;
    const dup = items.find((it) => it.file === file);
    if (dup) return { file: dup.file, reason: dup.reason, dup: true };

    if (collectedToday() >= cfg.collectPerDay) {
      log.warn && log.warn('   [图库] 今天已经收了 ' + cfg.collectPerDay + ' 张，不再收了');
      return null;
    }

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(srcPath, abs(file));
    } catch (e) {
      log.warn && log.warn('   [图库] 存图失败：' + (e && e.message));
      return null;
    }

    const clean = String(reason || '')
      .replace(/\[CQ:[^\]]*\]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 40) || '他给的图';
    items.push({ file, reason: clean, from: String(from || ''), addedAt: Date.now() });
    save();

    cacheMtime = -1;
    return { file, reason: clean };
  }

  function sentThisHour() {
    const cut = Date.now() - 3600 * 1000;
    sent = sent.filter((s) => s.t > cut);
    return sent.length;
  }

  function sentToday() {
    const today = dayKey();
    return sent.filter((s) => dayKey(s.t) === today).length;
  }

  function pick(keyword = '') {
    const items = load().items.filter((it) => {
      try {
        return fs.statSync(abs(it.file)).isFile();
      } catch {
        return false;
      }
    });
    if (!items.length) return null;
    const kw = String(keyword || '').trim();
    let pool = items;
    if (kw) {
      const hit = items.filter((it) => it.reason.includes(kw) || it.file.includes(kw));
      if (!hit.length) return null;
      pool = hit;
    }

    const recent = new Set(sent.slice(-3).map((s) => s.file));
    const fresh = pool.filter((it) => !recent.has(it.file));
    const list = fresh.length ? fresh : pool;
    return list[Math.floor(Math.random() * list.length)];
  }

  async function send(key, keyword, sendImage) {
    if (!cfg.enabled || typeof sendImage !== 'function') return false;
    const ask = keyword || '随便一张';
    if (sentThisHour() >= cfg.perHour) {
      say('   [图库] 想发「' + ask + '」，但这个小时已经发过 ' + cfg.perHour + ' 张了，先不发');
      return false;
    }
    if (sentToday() >= cfg.perDay) {
      say('   [图库] 想发「' + ask + '」，但今天已经发满 ' + cfg.perDay + ' 张了，先不发');
      return false;
    }
    const it = pick(keyword);
    if (!it) {
      say('   [图库] 想发「' + ask + '」，图库里没有对得上的（共 ' + count() + ' 张）');
      return false;
    }
    const ok = await sendImageFile({ sendImage }, abs(it.file), { mode: cfg.mode, maxMB: cfg.maxMB });
    if (!ok) {
      say('   [图库] 发 ' + it.file + ' 失败（图片太大或发送通道出错）');
      return false;
    }
    sent.push({ t: Date.now(), file: it.file });
    say('   [图库] 发了 ' + it.file + '（' + (it.reason || '没有理由') + '）');
    return true;
  }

  function items() {
    return load().items.slice();
  }

  function wanted(userText) {
    return Boolean(cfg.enabled) && SEE_ASK_RE.test(String(userText || ''));
  }

  function guessKeyword(userText) {
    const list = load().items;
    if (!list.length) return '';
    const stop = new Set(['把', '那张', '这张', '发我', '给我', '看看', '看下', '图', '图片', '照片',
      '你', '的', '吧', '呢', '啊', '一下', '图库', '图库里', '你图库', '再来', '来张']);
    const cands = String(userText || '')
      .split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)
      .filter(Boolean);
    const hit = (s) => list.some((it) => String(it.reason || '').includes(s) || String(it.file || '').includes(s));
    for (const c of cands) {
      if (c.length >= 2 && !stop.has(c) && hit(c)) return c;
    }

    for (const c of cands) {
      for (let i = 0; i + 2 <= c.length; i++) {
        const s = c.slice(i, i + 2);
        if (stop.has(s)) continue;
        if (hit(s)) return s;
      }
    }
    return '';
  }

  return { hint, collect, pick, send, count, items, wanted, guessKeyword };
}

export default { createGallery };
