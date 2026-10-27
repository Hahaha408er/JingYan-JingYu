

import { Memory } from './memory.js';
import { Role } from './role.js';
import { clockBlock } from './clock.js';
import { Digest } from './digest.js';
import { Extractor } from './extract.js';

const EMOJI_RE = /\[\[\s*(?:表情|表情包|图|图片)\s*[:：]\s*([^\[\]]{1,20})\s*\]\]/g;
function splitMarker(text) {
  let emoji = '';
  const cleaned = String(text || '')
    .replace(EMOJI_RE, (_m, tag) => { if (!emoji) emoji = String(tag).trim(); return ''; })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: cleaned, emoji };
}

const ECHO_RE = /^(好+|嗯+|恩+|哦+|噢+|喔+|行|行吧|好吧|得|可以|哈+|呵+|笑死|绷不住|草|绝了|6|66|666|\?+|？+|啥|知道了|懂了|收到|ok|OK|喂+|在吗|在不在|人|人呢|有人吗|滴滴+|呼叫|嗨+|嘿+|哈喽|hello|hi)+$/;

export function isEchoOnly(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((s) => s.replace(/^[^\s：:]{1,20}[：:]\s*/, '').replace(/\[CQ:[^\]]*\]/g, ''))
    .map((s) => s.replace(/[\s，,。.！!~～…、]+/g, '').replace(/[啦了呀啊呢吧]+$/, ''))
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.every((s) => s.length <= 8 && ECHO_RE.test(s));
}

const COLLECT_RE = /\[\[\s*(?:收藏|存图|收起来|收进图库)\s*(?:[:：]\s*([^\[\]]{0,40}))?\s*\]\]/g;
const SHOW_RE = /\[\[\s*(?:图库|翻图库|看图库|翻图)\s*(?:[:：]\s*([^\[\]]{0,30}))?\s*\]\]/g;

export class Brain {
  constructor({ apiKey, baseUrl = 'https://api.deepseek.com/v1', model = 'deepseek-chat', timeoutMs = 120000, role, memory, image = null }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;

    this.image = image && typeof image === 'object' ? image : {};
    this.role = role || new Role({ cardPath: 'role.md' });
    this.memory = memory || new Memory({ dir: './data' });

    this.digest = new Digest({
      memory: this.memory,
      apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
    });

    this.extract = new Extractor({
      memory: this.memory,
      apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
    });
  }

  async reply(input) {
    const { key, userId, userName, text, situation: sit = '', history = [], record = true, extraImages = [] } = input;

    const memLine = this.memory.renderPerson(userId);

    const recent = this.memory.renderRecent(20);

    const clockText = clockBlock(this.memory, userId);

    const dayText = this.digest.render();

    const focusLine = this.memory.lastReply(key);
    const echoOnly = isEchoOnly(text);
    const focusParts = [];
    if (focusLine) focusParts.push('【这句在回什么】你上一句是：「' + focusLine + '」。');
    if (echoOnly) {
      focusParts.push('他这条只是几个字的口头反应，不是提问：不许出现问号，不许说“什么”“说来听听”“话说一半”，'
        + '也不许让他解释。直接接着上一句说一句短的，或者损他一句。');
    } else if (focusLine) {
      focusParts.push('如果他只回了“好好好／嗯嗯／哈哈哈／笑死／？？？／哦”这种几个字，'
        + '那不是提问，是认可、是笑、是没听懂——顺着你刚才那句往下说，或者吐槽他一句，别问“什么”。');
    }
    const focusText = focusParts.join('');
    const situation = [clockText, dayText, sit, focusText].filter(Boolean).join('\n');

    void this.digest.tick();
    const sys = this.role.build({
      situation,
      memory: memLine,
      recent,
      platform: input.platform || '',
    });

    const messages = [{ role: 'system', content: sys }];
    for (const h of history.slice(-20)) {
      messages.push({ role: h.isSelf ? 'assistant' : 'user', content: String(h.text || '') });
    }

    let userContent = text || '';
    let imgBase64 = null;

    let imgFile = '';

    const imgMatch = text.match(/\[CQ:image,file=(.*?)\]/);
    if (imgMatch && imgMatch[1]) {
      let file = imgMatch[1];

      try {

          const imgBase = this.image.httpBase || 'http://127.0.0.1:3000';
          const imgToken = this.image.accessToken || '123456';
          const res = await fetch(`${imgBase}/get_image?file=${encodeURIComponent(file)}`, {
              headers: { authorization: 'Bearer ' + imgToken }
          });

          if (res.ok) {
              const jsonData = await res.json();

              if (jsonData.status === 'ok' && jsonData.data && jsonData.data.file) {

                  const inner = this.image.innerPrefix || '/app/.config/QQ';
                  const hostDir = this.image.volumeDir || '/var/lib/docker/volumes/7ae1d5456e71edd166e7637c9ad53307b7974ed24c72509be6414091a38469ee/_data';
                  const realFilePath = jsonData.data.file.replace(inner, hostDir);

                  const fs = await import('node:fs/promises');
                  const buffer = await fs.readFile(realFilePath);

                  const base64Str = buffer.toString('base64');

                  let ext = file.split('.').pop().toLowerCase();
                  if (!['png', 'webp', 'gif', 'jpeg', 'jpg'].includes(ext)) ext = 'jpeg';
                  if (ext === 'jpg') ext = 'jpeg';

                  imgBase64 = `data:image/${ext};base64,${base64Str}`;
                  console.log("✅ 成功从服务器本地读取到图片并转码！");
                  imgFile = realFilePath;
              }
          } else {
              console.error("❌ NapCat 拒绝给图，状态码：", res.status);
          }
      } catch (e) {
          console.error('❌ 读取本地图片文件失败:', e.message);
      }

      userContent = text.replace(/\[CQ:image,file=.*?\]/g, '').trim();
      if (!userContent) userContent = "看看这张图，跟我说点什么。";
    }

    const extra = Array.isArray(extraImages)
      ? extraImages.filter((x) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 2)
      : [];
    if (imgBase64 || extra.length) {
      const content = [{ type: 'text', text: userContent }];
      if (imgBase64) content.push({ type: 'image_url', image_url: { url: imgBase64 } });
      for (const im of extra) content.push({ type: 'image_url', image_url: { url: im } });
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'user', content: String(userContent) });
    }

    const res = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
      body: JSON.stringify({ model: this.model, messages, temperature: 1.1, stream: false }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw = await res.text();
    if (!res.ok) throw new Error('模型返回 ' + res.status + '：' + raw.slice(0, 300));

    let json;
    try { json = JSON.parse(raw); } catch { throw new Error('模型返回不是 JSON：' + raw.slice(0, 200)); }
    const msg = json.choices?.[0]?.message;

    const { text: rawOut, emoji } = splitMarker(String(msg?.content || '').trim());

    let out = rawOut;
    let collect = '';
    let show = null;
    out = out.replace(COLLECT_RE, (_m, r) => {
      collect = String(r || '').trim() || 'on';
      return '';
    }).trim();
    out = out.replace(SHOW_RE, (_m, k) => {
      show = String(k || '').trim();
      return '';
    }).trim();

    if (record) {

      const nm = String(userName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cleanSay = String(text || '')
        .replace(/\[CQ:[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(nm ? new RegExp('^' + nm + '\\s*[：:]\\s*') : /(?!)/, '')
        .trim();
      const topic = (cleanSay.slice(0, 40) || '[图片/表情]') + ' → ' + out.slice(0, 40);
      this.memory.remember(userId, { name: userName, topic });
      this.memory.logTurn({ where: key, who: userName || userId, text, reply: out, uid: userId });

      void this.extract.after(userId, { name: userName, owner: String(key || '').startsWith('private:') });
    }
    return { text: out, emoji, imgFile, collect, show, reasoning: msg?.reasoning_content, raw: json };
  }

  remember(userId, { trait, fact, topic, pending, name }) {
    return this.memory.remember(userId, { trait, fact, topic, pending, name });
  }
}

export default Brain;