

import fs from 'node:fs';
import path from 'node:path';

const ENABLED = true;
const INJECT_DAYS = 3;
const BACKFILL_MAX = 2;
const MIN_ROWS = 2;
const MAX_ROWS = 300;
const KEEP_INPUT_CHARS = 12000;
const TIMEOUT_MS = 60000;

const SYSTEM = [
  '你在帮一只住在 QQ 里的小鲸鱼整理"这一天发生了什么"。',
  '你只做摘要，不扮演任何人，不写感想，不写小作文。',
  '输出严格 JSON：{"lines": ["…", "…"]}，3~5 条，每条不超过 40 个字。',
  '每条只写具体发生过的事：他做了什么、说了什么、提到什么计划/情绪/身体状况，以及我回了什么。',
  '不要写"聊了天""互动愉快"这种空话。不要用"用户"这个词，直接写他的名字。',
].join('\n');

function dayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function tidy(s) {
  return String(s || '').replace(/\[CQ:[^\]]*\]/g, '（图）').replace(/\s+/g, ' ').trim();
}

function readJson(text) {
  const s = String(text || '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

export class Digest {

  constructor({ memory, apiKey = '', baseUrl = 'https://api.deepseek.com/v1', model = 'deepseek-chat', log = console } = {}) {
    this.memory = memory;
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.model = model;
    this.log = log;
    this.daysDir = path.join(memory?.dir || './data', 'days');
    this.busy = false;
    this.lastTryAt = 0;
  }

  #file(dateStr) {
    return path.join(this.daysDir, dateStr + '.json');
  }

  #done() {
    try {
      return new Set(
        fs.readdirSync(this.daysDir)
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .map((f) => f.slice(0, 10)),
      );
    } catch { return new Set(); }
  }

  #pendingDays() {
    const all = this.memory?.recentTurns?.(this.memory?.maxTurns || 2000) || [];
    const today = dayStr();
    const done = this.#done();
    const stat = new Map();
    for (const r of all) {
      const d = dayStr(new Date(Number(r.t) || 0));
      if (d >= today) continue;
      if (!done.has(d)) stat.set(d, (stat.get(d) || 0) + 1);
    }
    const limit = dayStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    return [...stat.entries()]
      .filter(([d, n]) => n >= MIN_ROWS && d >= limit)
      .map(([d]) => d)
      .sort();
  }

  #rowsOf(dateStr) {
    const all = this.memory?.recentTurns?.(this.memory?.maxTurns || 2000) || [];
    const rows = all.filter((r) => dayStr(new Date(Number(r.t) || 0)) === dateStr);
    const body = rows.slice(-MAX_ROWS).map((r) => {
      const who = String(r.who || '');
      const place = String(r.where || '').startsWith('group') ? '群里' : '私聊';
      const said = tidy(r.text);
      const back = tidy(r.reply);
      return '[' + place + '] ' + (said ? who + '：' + said : '') + (back ? '　/　我：' + back : '');
    }).join('\n');
    return body.length > KEEP_INPUT_CHARS ? body.slice(-KEEP_INPUT_CHARS) : body;
  }

  async #ask(dateStr, body) {
    const res = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: '日期：' + dateStr + '\n\n当天的对话：\n' + body },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const data = readJson(json?.choices?.[0]?.message?.content);
    const lines = Array.isArray(data?.lines) ? data.lines : [];
    return lines
      .map((x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 5);
  }

  async tick() {
    if (!ENABLED || this.busy || !this.apiKey) return;
    const now = Date.now();
    if (now - this.lastTryAt < 10 * 60 * 1000) return;
    this.lastTryAt = now;
    this.busy = true;
    try {
      let made = 0;
      for (const dateStr of this.#pendingDays()) {
        if (made >= BACKFILL_MAX) break;
        try {
          const body = this.#rowsOf(dateStr);
          if (!body) continue;
          const lines = await this.#ask(dateStr, body);
          if (!lines.length) continue;
          fs.mkdirSync(this.daysDir, { recursive: true });
          fs.writeFileSync(
            this.#file(dateStr),
            JSON.stringify({ date: dateStr, madeAt: Date.now(), lines }, null, 2),
            'utf8',
          );
          made += 1;
          this.log.log?.('   [日摘要] ' + dateStr + ' → ' + lines.length + ' 条');
        } catch (e) {
          this.log.warn?.('   [日摘要] ' + dateStr + ' 写失败：' + (e?.message || e));
        }
      }
    } catch (e) {
      this.log.warn?.('   [日摘要] 检查失败：' + (e?.message || e));
    } finally {
      this.busy = false;
    }
  }

  render(n = INJECT_DAYS) {
    if (!ENABLED) return '';
    try {
      const today = dayStr();
      const files = fs.readdirSync(this.daysDir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .filter((f) => f.slice(0, 10) < today)
        .sort()
        .slice(-n);
      if (!files.length) return '';
      const L = [];
      for (const f of files) {
        const d = JSON.parse(fs.readFileSync(path.join(this.daysDir, f), 'utf8'));
        if (Array.isArray(d?.lines) && d.lines.length) {
          L.push(f.slice(5, 10) + '：' + d.lines.join('；'));
        }
      }
      if (!L.length) return '';
      return '【你还记得的前几天】\n' + L.join('\n')
        + '\n（这是你自己总结过的，提起来要自然，别像在背档案）\n';
    } catch {
      return '';
    }
  }
}

export default { Digest };
