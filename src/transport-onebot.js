

import ws from 'ws';

function segsToText(segs) {
  if (!Array.isArray(segs)) return String(segs || '');
  const out = [];
  for (const s of segs) {
    if (!s) continue;
    switch (s.type) {
      case 'text': out.push(s.data?.text || ''); break;
      case 'at': out.push('@' + (s.data?.qq || '')); break;
      case 'image': out.push(`[CQ:image,file=${s.data?.file || ''}]`); break;
      case 'face': out.push('[表情]'); break;
      case 'reply': break;
      default: break;
    }
  }
  return out.join('').trim();
}

function findReply(segs) {
  if (!Array.isArray(segs)) return null;
  for (const s of segs) if (s?.type === 'reply') return String(s.data?.id || '');
  return null;
}

export class OneBot {

  constructor({ wsUrl, httpUrl, accessToken = '', onMessage }) {
    this.wsUrl = wsUrl;
    this.httpUrl = (httpUrl || '').replace(/\/+$/, '');
    this.accessToken = accessToken;
    this.onMessage = onMessage;
    this.selfId = '';
    this.ws = null;
    this.connected = false;
    this.lastSentMsg = '';
    this.lastSentTime = 0;
    this.#warnToken();
    this.#connect();
  }

  #warnToken() {
    const raw = String(this.accessToken == null ? '' : this.accessToken);
    const clean = raw.replace(/[^\x20-\x7E]/g, '').trim();
    if (raw && clean !== raw) {
      console.log('[onebot] accessToken 里有非 ASCII 字符（中文/全角空格/换行/BOM 之类），已忽略；建议去 config.json 里重填一次');
    }
    this.accessToken = clean;
  }

  #headers() {
    const h = {};
    if (this.accessToken) h.authorization = 'Bearer ' + this.accessToken;
    return h;
  }

  async #connect() {
    try {
      const ws = (await import('ws')).default;
      const sock = new ws(this.wsUrl, { headers: this.#headers() });

      sock.on?.('open', () => { this.connected = true; console.log('[onebot] 已连接 ' + this.wsUrl); });
      sock.on?.('close', () => {
        this.connected = false;
        console.log('[onebot] 断开，5 秒后重连');
        setTimeout(() => this.#connect(), 5000);
      });
      sock.on?.('error', (e) => console.log('[onebot] 出错 ' + (e?.message || e)));
      sock.on?.('message', (data) => {
        let ev;
        try { ev = JSON.parse(String(data)); } catch { return; }
        this.#handle(ev);
      });
    } catch (e) {

      this.connected = false;
      console.log('[onebot] 连接失败：' + (e?.message || e) + '，5 秒后重试');
      setTimeout(() => this.#connect(), 5000);
    }
  }

  #handle(ev) {
    if (ev.post_type === 'meta_event' && ev.meta_event_type === 'lifecycle') {
      this.selfId = String(ev.self_id || '');
      return;
    }
    if (ev.post_type !== 'message') return;
    if (ev.self_id) this.selfId = String(ev.self_id);

    const isGroup = ev.message_type === 'group';
    const segs = ev.message;
    const replyId = findReply(segs);

    const atMe = Array.isArray(segs) && segs.some((s) => s?.type === 'at' && String(s.data?.qq) === this.selfId);

    const msg = {
      key: isGroup ? 'group:' + ev.group_id : 'private:' + ev.user_id,
      isGroup,
      groupId: isGroup ? String(ev.group_id) : '',
      userId: String(ev.user_id),
      name: String(ev.sender?.card || ev.sender?.nickname || ev.user_id),
      text: segsToText(segs),
      raw: segs,
      isAtMe: atMe,
      isQuoteMe: false,
      replyTo: replyId,
      messageId: String(ev.message_id || ''),
      time: (ev.time || Math.floor(Date.now() / 1000)) * 1000,
    };
    this.onMessage?.(msg);
  }

  async api(action, params = {}) {
    if (!this.httpUrl) return { ok: false, error: '没配 httpUrl' };
    try {
      const r = await fetch(this.httpUrl + '/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers() },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(30000),
      });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { ok: r.ok && j.status !== 'failed', data: j, error: j.message || j.wording };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  send(key, text, { atUserId } = {}) {

    const now = Date.now();
    if (this.lastSentMsg === text && now - this.lastSentTime < 2000) {
        return { ok: true, error: '拦截了重复发送' };
    }
    this.lastSentMsg = text;
    this.lastSentTime = now;
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    let message = String(text);
    if (atUserId) message = '[CQ:at,qq=' + atUserId + '] ' + message;
    return isGroup
      ? this.api('send_group_msg', { group_id: id, message })
      : this.api('send_private_msg', { user_id: id, message });
  }

  sendImage(key, file) {
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    const message = '[CQ:image,file=' + file + ']';
    return isGroup
      ? this.api('send_group_msg', { group_id: id, message })
      : this.api('send_private_msg', { user_id: id, message });
  }

  async setTyping(key, on) {
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    return this.api('set_input_status', isGroup
      ? { group_id: id, event_type: on ? 1 : 0 }
      : { user_id: id, event_type: on ? 1 : 0 });
  }

  async whoSent(messageId) {
    const r = await this.api('get_msg', { message_id: messageId });
    return r.ok ? String(r.data?.data?.user_id || '') : '';
  }
}

export { segsToText };
export default OneBot;
