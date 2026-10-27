

import fs from 'node:fs';
import path from 'node:path';

const ENABLED = true;
const SCOPE = 'all';
const ONLY_IDS = [];
const EVERY_N = 6;
const LOOKBACK = 8;
const MAX_FACTS = 3;
const MAX_TRAITS = 1;
const MAX_PENDING = 2;
const TIMEOUT_MS = 60000;

const SYSTEM = [
  '你在帮一只住在 QQ 里的小鲸鱼整理她对这个人的印象。',
  '你不是在写总结报告，你是在帮她想「下次跟他说话时该记住什么」。',
  '输出严格 JSON：{"facts":["…"],"traits":["…"],"pending":["…"]}',
  'facts 写他主动说过、且以后还用得上的事实（在做什么、作息、工作、计划、他提到的人或事），每条 ≤35 字。',
  'traits 写你对他性格/习惯的新印象，像人话，每条 ≤20 字，不要写"友好""善良"这种通稿。',
  'pending 写他明显没说完、或你打算下次主动问起的事，每条 ≤30 字；没有就留空数组。',
  '已经办成、已经给他看过、已经兑现的事，不要写进 pending——pending 只留"还欠着、下次见面该提起"的。',
  '不要自己写日期，也不要用"今天""昨天""最近"这类词——系统会自动给每条标上时间。',
  '一次性的东西（今天吃了什么、天气、纯玩笑、测试性提问）不要进 facts。',
  '已知的不要再重复；意思相同或相近的也别重复写，哪怕换了说法（"下午5点去健身"和"五点半或六点去健身"是同一条）。',
  '宁可少写，不要凑数。三个数组都可以是空的。',
].join('\n');

function tidy(s) {
  return String(s || '').replace(/\[CQ:[^\]]*\]/g, '（图）').replace(/\s+/g, ' ').trim();
}

function oldText(x) {
  return typeof x === 'string' ? x : String(x?.t || '');
}

function readJson(text) {
  const s = String(text || '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

export class Extractor {

  constructor({ memory, apiKey = '', baseUrl = 'https://api.deepseek.com/v1', model = 'deepseek-chat', log = console } = {}) {
    this.memory = memory;
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.model = model;
    this.log = log;
    this.file = path.join(memory?.dir || './data', 'extract.json');
    this.busy = false;
  }

  #state() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { return {}; }
  }

  #save(st) {
    try { fs.writeFileSync(this.file, JSON.stringify(st, null, 2), 'utf8'); } catch {  }
  }

  async after(userId, { name = '', owner = false } = {}) {
    if (!ENABLED || !this.apiKey || this.busy) return;
    const id = String(userId);
    if (SCOPE === 'private' && !owner) return;
    if (ONLY_IDS.length && !ONLY_IDS.map(String).includes(id)) return;
    try {
      const st = this.#state();
      const s = st[id] || (st[id] = { n: 0, ranAt: 0 });
      s.n = (Number(s.n) || 0) + 1;
      if (s.n < EVERY_N) { this.#save(st); return; }
      s.n = 0;
      s.ranAt = Date.now();
      this.#save(st);
      await this.#run(id, name);
    } catch (e) {
      this.log.warn?.('   [记账] 跳过：' + (e?.message || e));
    }
  }

  #body(id, name) {
    const rows = this.memory?.recentTurns?.(400) || [];
    const mine = rows.filter((r) => {
      const uid = String(r.uid || '');
      if (uid) return uid === id;
      return !!name && String(r.who || '') === name;
    }).slice(-LOOKBACK);
    return mine.map((r) => {
      const who = String(r.who || '');
      const said = tidy(r.text);
      const back = tidy(r.reply);
      return (said ? who + '：' + said : '') + (back ? '　/　我：' + back : '');
    }).filter(Boolean).join('\n');
  }

  async #run(id, name) {
    this.busy = true;
    try {
      const body = this.#body(id, name);
      if (!body) return;
      const known = this.memory?.renderPerson?.(id) || '（还没有）';
      const res = await fetch(this.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM },
            {
              role: 'user',
              content: '这个人叫：' + (name || id) + '\n\n你现在的账本：\n' + known
                + '\n\n最近几轮对话：\n' + body,
            },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const data = readJson(json?.choices?.[0]?.message?.content);
      if (!data) return;

      const pick = (v, max) => (Array.isArray(v) ? v : [])
        .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, max);

      const facts = pick(data.facts, MAX_FACTS);
      const traits = pick(data.traits, MAX_TRAITS);
      const pending = pick(data.pending, MAX_PENDING);

      const p = this.memory?.person?.(id);
      const norm = (s) => String(s || '').replace(/[\s，。！？、,.!?~…；;：:""''「」『』（）()]/g, '');
      const grams = (s) => {
        const out = new Set();
        for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
        return out;
      };
      const dice = (a, b) => {
        if (!a || !b) return 0;
        const A = grams(a);
        const B = grams(b);
        if (!A.size || !B.size) return a === b ? 1 : 0;
        let hit = 0;
        for (const x of A) if (B.has(x)) hit++;
        return (2 * hit) / (A.size + B.size);
      };
      const fresh = (arr, list) => {
        const old = (arr || []).map(oldText).filter(Boolean);
        return list.filter((s) => !old.some((o) => o === s || o.includes(s) || s.includes(o)
          || dice(norm(o), norm(s)) >= 0.62));
      };
      const nf = fresh(p?.facts, facts);
      const nt = fresh(p?.traits, traits);
      const np = fresh(p?.pending, pending);
      if (!nf.length && !nt.length && !np.length) return;

      this.memory.addNotes?.(id, { facts: nf, traits: nt, pending: np });
      const bits = [];
      if (nf.length) bits.push('事实+' + nf.length);
      if (nt.length) bits.push('印象+' + nt.length);
      if (np.length) bits.push('待续+' + np.length);
      this.log.log?.('   [记账] ' + (name || id) + ' ' + bits.join(' '));
    } catch (e) {
      this.log.warn?.('   [记账] 失败：' + (e?.message || e));
    } finally {
      this.busy = false;
    }
  }
}

export default { Extractor };
