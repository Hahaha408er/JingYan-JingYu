

import fs from 'node:fs';
import path from 'node:path';
import { clockLabel } from './clock.js';

function stripSpeaker(text, who) {
  const s = String(text || '');
  if (!s || !who) return s.trim();
  const esc = String(who).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp('(^|\\n)\\s*' + esc + '\\s*[：:]\\s*', 'g'), '$1').trim();
}

const FACT_TTL_DAYS = 14;
const PENDING_TTL_DAYS = 10;

function noteText(it) {
  if (typeof it === 'string') return it;
  return String(it?.t || '');
}

function noteAge(at) {
  if (!Number(at)) return -1;
  const d = new Date(Number(at));
  if (Number.isNaN(d.getTime())) return -1;
  const now = new Date();
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}

function noteMark(at) {
  const age = noteAge(at);
  if (age <= 0) return '';
  if (age === 1) return '（昨天说的）';
  const d = new Date(Number(at));
  if (age <= 7) return '（' + (d.getMonth() + 1) + '-' + d.getDate() + ' 说的）';
  return '（早前说的）';
}

function renderNotes(arr, max, ttlDays) {
  const out = [];
  for (const it of Array.isArray(arr) ? arr : []) {
    const t = noteText(it).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const at = typeof it === 'string' ? 0 : Number(it?.at) || 0;
    if (ttlDays > 0 && noteAge(at) > ttlDays) continue;
    out.push(t + noteMark(at));
  }
  return out.slice(-max).join('；');
}

export class Memory {

  constructor({ dir, maxTopics = 20, maxTurns = 400 } = {}) {
    this.dir = dir;
    this.peopleFile = path.join(dir, 'people.json');
    this.turnsFile = path.join(dir, 'turns.jsonl');
    this.maxTopics = maxTopics;
    this.maxTurns = maxTurns;
    fs.mkdirSync(dir, { recursive: true });
  }

  #readAll() {
    try { return JSON.parse(fs.readFileSync(this.peopleFile, 'utf8')); } catch { return {}; }
  }
  #writeAll(j) {
    fs.writeFileSync(this.peopleFile, JSON.stringify(j, null, 2), 'utf8');
  }

  person(id, { name } = {}) {
    const all = this.#readAll();
    const key = String(id);
    if (!all[key]) {
      all[key] = {
        name: name || key,
        traits: [], facts: [], topics: [], pending: [],
        interactions: 0,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      this.#writeAll(all);
    }
    const p = all[key];

    for (const k of ['traits', 'facts', 'topics', 'pending']) if (!Array.isArray(p[k])) p[k] = [];
    if (name && p.name !== name) { p.name = name; this.#writeAll(all); }
    return p;
  }

  remember(id, { trait, fact, topic, pending, name } = {}) {
    const all = this.#readAll();
    const key = String(id);
    if (!all[key]) {
      all[key] = { name: name || key, traits: [], facts: [], topics: [], pending: [], interactions: 0, firstSeenAt: Date.now(), lastSeenAt: Date.now() };
    }
    const p = all[key];
    for (const k of ['traits', 'facts', 'topics', 'pending']) if (!Array.isArray(p[k])) p[k] = [];
    if (name) p.name = String(name).slice(0, 40);

    const put = (arr, v) => {
      const s = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!s) return;
      const i = arr.indexOf(s);
      if (i >= 0) arr.splice(i, 1);
      arr.push(s);
    };

    if (trait) put(p.traits, trait);
    if (fact) put(p.facts, fact);
    if (topic) put(p.topics, topic);
    if (pending) put(p.pending, pending);

    while (p.topics.length > this.maxTopics) p.topics.shift();
    while (p.traits.length > 40) p.traits.shift();
    while (p.facts.length > 60) p.facts.shift();
    while (p.pending.length > 12) p.pending.shift();

    p.lastSeenAt = Date.now();
    p.interactions = (Number(p.interactions) || 0) + 1;
    this.#writeAll(all);
    return p;
  }

  touch(id, { name } = {}) {
    const all = this.#readAll();
    const key = String(id);
    if (!all[key]) return this.remember(key, { name });
    all[key].lastSeenAt = Date.now();
    all[key].interactions = (Number(all[key].interactions) || 0) + 1;
    if (name) all[key].name = String(name).slice(0, 40);
    this.#writeAll(all);
  }

  addNotes(id, { facts = [], traits = [], pending = [] } = {}) {
    const all = this.#readAll();
    const key = String(id);
    if (!all[key]) return null;
    const p = all[key];
    const put = (arr, s, withTime) => {
      const v = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!v) return;
      const i = arr.findIndex((x) => noteText(x) === v);
      if (i >= 0) arr.splice(i, 1);
      arr.push(withTime ? { t: v, at: Date.now() } : v);
    };
    if (!Array.isArray(p.facts)) p.facts = [];
    if (!Array.isArray(p.traits)) p.traits = [];
    if (!Array.isArray(p.pending)) p.pending = [];
    for (const s of facts) put(p.facts, s, true);
    for (const s of traits) put(p.traits, s, false);
    for (const s of pending) put(p.pending, s, true);
    while (p.facts.length > 60) p.facts.shift();
    while (p.traits.length > 40) p.traits.shift();
    while (p.pending.length > 12) p.pending.shift();
    this.#writeAll(all);
    return p;
  }

  dropPending(id, keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return 0;
    const all = this.#readAll();
    const key = String(id);
    if (!all[key] || !Array.isArray(all[key].pending)) return 0;
    const p = all[key];
    const before = p.pending.length;
    p.pending = p.pending.filter((x) => !String(noteText(x)).includes(kw));
    const removed = before - p.pending.length;
    if (removed) this.#writeAll(all);
    return removed;
  }

  logTurn({ where, who, text, reply, uid }) {
    const rec = {
      t: Date.now(),
      where: String(where || ''),
      uid: String(uid || ''),
      who: String(who || '').slice(0, 30),
      text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      reply: String(reply || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    };
    if (!rec.text && !rec.reply) return;
    try {
      fs.appendFileSync(this.turnsFile, JSON.stringify(rec) + '\n', 'utf8');

      const lines = fs.readFileSync(this.turnsFile, 'utf8').trim().split('\n');
      if (lines.length > this.maxTurns) {
        fs.writeFileSync(this.turnsFile, lines.slice(-this.maxTurns).join('\n') + '\n', 'utf8');
      }
    } catch {  }
  }

  recentTurns(n = 20, { excludeWhere, sinceMs } = {}) {
    let rows = [];
    try {
      rows = fs.readFileSync(this.turnsFile, 'utf8').trim().split('\n')
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch { return []; }
    if (sinceMs) rows = rows.filter((r) => Date.now() - r.t < sinceMs);
    if (excludeWhere) rows = rows.filter((r) => !String(r.where || '').startsWith(excludeWhere));
    return rows.slice(-n);
  }

  renderPerson(id) {
    const p = this.#readAll()[String(id)];
    if (!p) return '';
    const L = [];
    const traits = (p.traits || []).map(noteText).filter(Boolean);
    if (traits.length) L.push('你了解他：' + traits.slice(-12).join('；'));
    const facts = renderNotes(p.facts, 12, FACT_TTL_DAYS);
    if (facts) L.push('他告诉过你：' + facts);
    if (p.topics?.length) L.push('你们聊过：' + p.topics.slice(-8).join('；'));
    const pend = renderNotes(p.pending, 4, PENDING_TTL_DAYS);
    if (pend) L.push('⚠️ 你心里还记着没说出口的事：' + pend);
    if (p.interactions) L.push('你们互动过 ' + p.interactions + ' 次');
    if (!L.length) return '';
    const tail = (facts || pend)
      ? '\n（括号里是这话多久以前说的，别把早前的事当成现在）'
      : '';
    return '【关于 ' + (p.name || id) + '（' + id + '）的一本账】\n' + L.join('\n') + tail + '\n';
  }

  lastReply(where, max = 80) {
    if (!where) return '';
    try {
      const rows = this.recentTurns(40);
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (String(r.where || '') !== String(where)) continue;
        const t = String(r.reply || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        const cuts = t.split(/(?<=[。！？!?~…；;])/).map((s) => s.trim()).filter(Boolean);
        const last = cuts.length ? cuts[cuts.length - 1] : t;
        return last.slice(0, max);
      }
      return '';
    } catch {
      return '';
    }
  }

  renderRecent(n = 20, opts = {}) {
    const rows = this.recentTurns(n, opts);
    if (!rows.length) return '';
    const lines = rows.map((r) => {

      const when = clockLabel(r.t);
      const place = String(r.where || '').startsWith('group') ? '群里' : '私聊';
      const who = String(r.who || '');
      const parts = [];
      const said = stripSpeaker(r.text, who);
      if (said) parts.push(who + '（' + place + '）：' + said);
      if (r.reply) parts.push('你：' + r.reply);
      return '  ' + when + '  ' + parts.join('\n        ');
    });
    return '【最近的真实对话（跨场合合在一起）】\n' + lines.join('\n')
      + '\n（这些是真说过的，别装作不知道，也别生硬复述）\n';
  }

  dump() {
    return { people: this.#readAll(), turns: this.recentTurns(1e9) };
  }
}
