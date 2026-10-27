

const NIGHT = { from: 2, to: 7 };

const DEFAULT_MS_PER_CHAR = 85;

export class Humanizer {

  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.msPerChar = opts.msPerChar ?? DEFAULT_MS_PER_CHAR;
    this.minMs = opts.minMs ?? 1200;
    this.maxMs = opts.maxMs ?? 6000;
    this.jitter = opts.jitter ?? 0.2;
    this.burstMax = opts.burstMax ?? 4;
    this.gapRange = opts.gapRange ?? [700, 2600];
    this.longGapChance = opts.longGapChance ?? 0.25;
    this.longGapRange = opts.longGapRange ?? [3000, 9000];
  }

  typingMsFor(text) {
    const n = [...String(text || '')].length;
    let ms = this.minMs + n * this.msPerChar;
    ms = Math.min(this.maxMs, Math.max(this.minMs, ms));

    ms *= 1 + (Math.random() * 2 - 1) * this.jitter;

    const h = new Date().getHours();
    if (h >= NIGHT.from && h < NIGHT.to) ms *= 1.6;
    return Math.round(ms);
  }

  gapMs() {
    const [a, b] = this.gapRange;
    let ms = a + Math.random() * Math.max(0, b - a);
    if (Math.random() < this.longGapChance) {
      const [c, d] = this.longGapRange;
      ms += c + Math.random() * Math.max(0, d - c);
    }
    return Math.round(ms);
  }

  split(text, max = this.burstMax) {
    const raw = String(text || '').trim();
    if (!raw) return [];

    let parts = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);

    const out = [];
    for (const p of parts) {
      if ([...p].length <= 40) { out.push(p); continue; }
      const segs = p.split(/(?<=[。！？!?…~])\s*/).map((s) => s.trim()).filter(Boolean);
      out.push(...(segs.length ? segs : [p]));
    }

    const merged = [];
    for (const s of out) {
      const last = merged[merged.length - 1];
      if (last && [...last].length < 6 && [...last].length + [...s].length <= 24) merged[merged.length - 1] = last + s;
      else merged.push(s);
    }

    if (merged.length > max) {
      const head = merged.slice(0, max - 1);
      head.push(merged.slice(max - 1).join(' '));
      return head;
    }
    return merged;
  }

  async say(text, { setTyping, send, sleep } = {}) {
    const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const parts = Array.isArray(text) ? text.map((s) => String(s)) : this.split(text);
    if (!parts.length) return { sent: 0, parts: [] };

    if (!this.enabled) {
      for (const p of parts) await send(p);
      return { sent: parts.length, parts };
    }

    let sent = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];

      if (setTyping) { try { await setTyping(true); } catch {  } }
      await wait(this.typingMsFor(p));
      if (setTyping) { try { await setTyping(false); } catch {} }

      await send(p);
      sent++;

      if (i < parts.length - 1) await wait(this.gapMs());
    }
    return { sent, parts };
  }
}

export default Humanizer;
