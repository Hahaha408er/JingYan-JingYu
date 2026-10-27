

const QUESTION_HINTS = /[?？]|怎么|为什么|为啥|如何|是不是|能不能|可不可以|有没有|谁|哪儿|哪里|何时|多少/;

export class Waker {

  constructor(opts = {}) {
    this.names = (opts.names || []).filter(Boolean);
    this.keywords = (opts.keywords || []).filter(Boolean);
    this.ownerIds = (opts.ownerIds || []).map(String);
    this.probability = opts.probability ?? 0.05;
    this.batchWindowMs = opts.batchWindowMs ?? 3000;

    this.configs = new Map();

    this.buffers = new Map();
  }

  setConfig(key, cfg) {
    this.configs.set(key, {
      mode: 'diving',
      infinite: true,
      until: 0,
      atMention: true,
      nameMention: true,
      keywords: [],
      question: true,
      poke: true,
      speakerIds: [],
      probability: this.probability,
      anyMessage: false,
      ...cfg,
    });
  }

  getConfig(key) {
    if (!this.configs.has(key)) this.setConfig(key, {});
    return this.configs.get(key);
  }

  isDiving(key) {
    const c = this.getConfig(key);
    if (c.mode === 'active') return false;
    if (c.infinite) return true;
    return Date.now() < c.until;
  }

  wake(key) {
    const c = this.getConfig(key);
    c.lastWakeAt = Date.now();
    c.wakeCount = (c.wakeCount || 0) + 1;
  }

  dive(key, ms = 0) {
    const c = this.getConfig(key);
    c.infinite = !ms;
    c.until = ms ? Date.now() + ms : 0;
  }

  shouldWake(msg) {
    const c = this.getConfig(msg.key);
    const text = String(msg.text || '');
    const uid = String(msg.userId || '');

    const admins = msg.admins ? new Set([...msg.admins].map(String)) : new Set(this.ownerIds);

    if (admins.has(uid) && c.mode !== 'active') return { wake: true, reason: 'owner' };
    if (Array.isArray(c.speakerIds) && c.speakerIds.map(String).includes(uid)) {
      return { wake: true, reason: 'speaker' };
    }

    if (c.anyMessage) return { wake: true, reason: 'anyMessage' };
    if (c.mode === 'active') return { wake: true, reason: 'active' };

    if (c.atMention && (msg.isAtMe || msg.isQuoteMe)) return { wake: true, reason: 'atMention' };

    if (c.poke && msg.isPoke) return { wake: true, reason: 'poke' };

    if (c.nameMention) {
      const hit = this.names.find((n) => text.includes(n));
      if (hit) return { wake: true, reason: 'name:' + hit };
    }

    const kw = [...(c.keywords || []), ...this.keywords];
    if (kw.length) {
      const hit = kw.find((k) => k && text.includes(k));
      if (hit) return { wake: true, reason: 'keyword:' + hit };
    }

    if (c.question && QUESTION_HINTS.test(text) && [...text].length >= 4) {
      return { wake: true, reason: 'question' };
    }

    if (Number(c.probability) > 0 && Math.random() < Number(c.probability)) {
      return { wake: true, reason: 'probability' };
    }

    return { wake: false, reason: '' };
  }

  batch(msg) {
    const key = msg.key;
    let b = this.buffers.get(key);
    if (!b) { b = { items: [], timer: null }; this.buffers.set(key, b); }
    b.items.push(msg);
    if (b.items.length >= 6) return { ready: true, batch: this.#flush(key) };
    return { ready: false, batch: [] };
  }

  #flush(key) {
    const b = this.buffers.get(key);
    if (!b) return [];
    const items = b.items;
    b.items = [];
    return items;
  }

  flush(key) { return this.#flush(key); }

  static joinBatch(items) {
    return items.map((m) => {
      const who = m.name || m.userId || '某人';
      return who + '：' + String(m.text || '').trim();
    }).join('\n');
  }
}

export default Waker;
