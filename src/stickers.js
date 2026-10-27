

import fs from 'node:fs';
import path from 'node:path';
import { sendImageFile } from './media.js';

const HOUR = 3600 * 1000;

export function createStickers({
  dir = 'data/stickers',
  indexFile = '',
  mode = 'base64',
  maxMB = 4,
  perHour = 3,
  groupPerHour = 2,
  avoid = 3,
  quiet = [],
  log = console,
} = {}) {
  const root = dir;
  const idxPath = indexFile || path.join(root, 'index.json');

  let items = [];
  let tags = [];
  let loadedMtime = -1;

  const recent = new Map();

  const sentAt = new Map();

  function load() {
    let st;
    try {
      st = fs.statSync(idxPath);
    } catch {
      items = [];
      tags = [];
      loadedMtime = -1;
      return;
    }
    if (st.mtimeMs === loadedMtime) return;
    try {
      const raw = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
      items = list
        .filter((it) => it && typeof it.file === 'string' && it.file)
        .map((it) => ({
          file: String(it.file),
          full: path.resolve(root, String(it.file)),
          tags: (Array.isArray(it.tags) ? it.tags : (it.tag ? [it.tag] : [])).map(String),
          note: String(it.note || ''),
        }))

        .filter((it) => {
          try { return fs.statSync(it.full).isFile(); } catch { return false; }
        });
      tags = Array.isArray(raw.tags) && raw.tags.length
        ? raw.tags.map(String)
        : [...new Set(items.flatMap((i) => i.tags))];
      loadedMtime = st.mtimeMs;
    } catch (e) {

      log?.warn?.('[stickers] index.json 读不了：' + (e?.message || e));
      items = [];
      tags = [];
      loadedMtime = -1;
    }
  }

  function hint() {
    load();
    if (!items.length || !tags.length) return '';
    return '【表情包】你手上有这些表情标签：' + tags.join(' / ') +
      '。偶尔（不是每次）想甩一张的时候，在回复最后单独一行写 [[表情:标签]]。' +
      '这行是系统指令、会被自动摘掉，正文里不要提、不要解释、不要在同一行写别的。' +
      '大部分时候不发，只在那个情绪真的到位时才发。';
  }

  function inQuietHour() {
    if (!Array.isArray(quiet) || quiet.length !== 2) return false;
    const [a, b] = quiet;
    const h = new Date().getHours();
    return a <= b ? (h >= a && h < b) : (h >= a || h < b);
  }

  function overLimit(key) {
    const now = Date.now();
    const arr = (sentAt.get(key) || []).filter((t) => now - t < HOUR);
    sentAt.set(key, arr);

    const cap = String(key || '').startsWith('group:') ? groupPerHour : perHour;
    return arr.length >= cap;
  }

  function pick(tag, key) {
    const t = String(tag || '').trim();
    if (!t) return null;
    const cands = items.filter((i) => i.tags.includes(t) || i.note.includes(t));
    if (!cands.length) return null;
    const rec = recent.get(key) || [];
    const fresh = cands.filter((c) => !rec.includes(c.full));
    const pool = fresh.length ? fresh : cands;
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }

  async function send(key, tag, sendImage) {
    if (!tag) return false;
    if (inQuietHour()) return false;
    if (overLimit(key)) return false;
    load();
    if (!items.length) return false;
    const item = pick(tag, key);
    if (!item) return false;
    const ok = await sendImageFile({ sendImage }, item.full, { mode, maxMB });
    if (!ok) return false;
    const arr = sentAt.get(key) || [];
    arr.push(Date.now());
    sentAt.set(key, arr);
    const rec = (recent.get(key) || []).concat([item.full]);
    recent.set(key, rec.slice(-Math.max(1, avoid)));
    return true;
  }

  return {
    hint,
    send,
    tags: () => {
      load();
      return tags.slice();
    },
    count: () => {
      load();
      return items.length;
    },
  };
}

export default createStickers;
