

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Memory } from './memory.js';
import { Role } from './role.js';
import { Brain } from './brain.js';
import { Humanizer } from './humanize.js';
import { Waker } from './wake.js';
import { OneBot } from './transport-onebot.js';
import { createStickers } from './stickers.js';
import { createGallery } from './gallery.js';
import { createProactive } from './proactive.js';
import { createMood } from './mood.js';
import { createLife } from './life.js';
import { createFeatures } from './features.js';
import { adminsOf, gidOf, groupCfg, groupWakeCfg, isAdminIn } from './scope.js';
import { checkConfig } from './config-check.js';
import { loadLicense, describeLicense } from './license.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function optional(name) {
  try {
    return await import(name);
  } catch (e) {
    if (e && (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND')) {
      console.warn('  [模块] 没有 ' + name + '，对应功能跳过');
      return null;
    }
    throw e;
  }
}

export function loadConfig(explicitPath) {
  const file = explicitPath || path.join(__dirname, '..', 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { console.error('⚠️ 读不到 ' + file + '，用默认值（复制 config.example.json 改名即可）'); }
  const dir = path.dirname(path.resolve(file));
  const rel = (p, def) => (p ? path.resolve(dir, p) : path.join(dir, def));

  return {
    apiKey: cfg.apiKey || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1',
    model: cfg.model || 'deepseek-chat',

    roleCard: rel(cfg.roleCard, 'role.md'),
    roleMaxChars: cfg.roleMaxChars || 12000,

    ownerName: String(cfg.ownerName || '').trim(),
    dataDir: rel(cfg.dataDir, 'data'),

    onebot: {
      wsUrl: cfg.onebot?.wsUrl || 'ws://127.0.0.1:3001',
      httpUrl: cfg.onebot?.httpUrl || 'http://127.0.0.1:3000',
      accessToken: cfg.onebot?.accessToken || '',
    },

    names: cfg.names || [],
    keywords: cfg.keywords || [],
    ownerIds: (cfg.ownerIds || []).map(String),

    wake: {
      probability: cfg.wake?.probability ?? 0.05,
      groupAtOnly: cfg.wake?.groupAtOnly !== false,
      privateWindowMs: cfg.wake?.privateWindowMs ?? 1500,
      groupWindowMs: cfg.wake?.groupWindowMs ?? 6000,
    },

    humanize: cfg.humanize || {},

    stickers: cfg.stickers || {},
    gallery: cfg.gallery || {},
    listening: cfg.listening || {},
    lastfm: cfg.lastfm || {},
    phone: cfg.phone || {},
    voice: cfg.voice || {},
    mood: cfg.mood || {},
    life: cfg.life || {},
    profile: cfg.profile || {},
    features: cfg.features || {},
    proactive: cfg.proactive || {},
    diary: cfg.diary || {},
    diaryDir: rel(cfg.diaryDir, 'data/diary'),
    diaryMaxChars: cfg.diaryMaxChars || 2000,
    license: cfg.license || '',
    dryRun: process.argv.includes('--dry-run'),
  };
}

async function main() {
  const cfgIdx = process.argv.indexOf('--config');
  const cfg = loadConfig(cfgIdx >= 0 ? process.argv[cfgIdx + 1] : null);

  try { checkConfig(cfg, { root: __dirname + '/..' }); } catch (e) { console.warn('[配置] 体检本身出错了：' + ((e && e.message) || e)); }

  console.log('════════ 鲸言鲸语 ════════');
  console.log('  模型      ' + cfg.model + ' @ ' + cfg.baseUrl);
  console.log('  角色卡    ' + cfg.roleCard);
  console.log('  数据目录  ' + cfg.dataDir);
  console.log('  OneBot    ' + cfg.onebot.wsUrl);
  console.log('  名字      ' + (cfg.names.join(' / ') || '（没配）'));
  console.log('  主人      ' + (cfg.ownerIds.join(', ') || '（没配）'));
  console.log('  干跑      ' + (cfg.dryRun ? '是（不会真发）' : '否'));
  console.log('');

  const memory = new Memory({ dir: cfg.dataDir });
  const role = new Role({ cardPath: cfg.roleCard, maxChars: cfg.roleMaxChars, ownerName: cfg.ownerName });

  const lint = role.lint();
  if (!lint.ok) {
    console.log('⚠️ 角色卡检查：');
    lint.warn.forEach((w) => console.log('   · ' + w));
    console.log('');
  }
  if (process.argv.includes('--check')) { console.log('检查完毕。'); return; }
  if (!cfg.apiKey) console.log('⚠️ 没配 apiKey，模型调用会失败\n');

  const features = createFeatures({ dataDir: cfg.dataDir, config: cfg.features });
  const OWNER = cfg.ownerIds[0];
  const allow = (k) => features.has(OWNER, k);
  console.log('  功能      ' + features.summary(OWNER));
  console.log(describeLicense(loadLicense({ dataDir: cfg.dataDir, config: cfg })));

  const modDiary = allow('diary') ? await optional('./diary-bridge.js') : null;
  const modListen = allow('listen') ? await optional('./listening.js') : null;
  const modLastfm = modListen ? await optional('./lastfm.js') : null;
  const modPhoneTunnel = allow('phone') ? await optional('./phone-tunnel.js') : null;
  const modPhone = modPhoneTunnel ? await optional('./phone.js') : null;
  const modVoice = allow('voice') ? await optional('./voice.js') : null;
  const modProfile = allow('profile') ? await optional('./profile.js') : null;

  const diaryBook = (allow('diary') && modDiary) ? modDiary.createDiaryBridge({
    dir: cfg.diaryDir,
    maxChars: cfg.diaryMaxChars,
    roleCard: cfg.roleCard,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    memory,
    config: cfg.diary,
  }) : null;

  const brain = new Brain({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    role,
    memory,
    diary: diaryBook,

    image: {
      httpBase: cfg.onebot && cfg.onebot.httpUrl,
      accessToken: cfg.onebot && cfg.onebot.accessToken,
      volumeDir: cfg.onebot && cfg.onebot.imageVolume,
      innerPrefix: cfg.onebot && cfg.onebot.imagePrefix,
    },
  });
  const human = new Humanizer(cfg.humanize);

  const stickers = allow('stickers') ? createStickers({
    dir: path.join(cfg.dataDir, 'stickers'),
    ...(cfg.stickers || {}),
  }) : null;
  if (stickers) console.log('  表情包    ' + stickers.count() + ' 张 / ' + (stickers.tags().join(' ') || '（空）'));

  const gallery = allow('gallery') ? createGallery({
    dir: path.join(cfg.dataDir, 'gallery'),
    ...(cfg.gallery || {}),
  }) : null;
  if (gallery) console.log('  图库      ' + gallery.count() + ' 张');

  const listening = (allow('listen') && modListen) ? modListen.createListening({
    dir: path.join(cfg.dataDir, 'listening'),
    ...(cfg.listening || {}),
  }) : null;
  if (listening) {
    const now = listening.current();
    console.log('  在听      ' + (now.title ? now.title + (now.artist ? ' - ' + now.artist : '') : '（还没收到分享）'));
  }

  const lastfm = (allow('listen') && listening && modLastfm) ? modLastfm.createLastFm({
    enabled: cfg.lastfm.enabled !== false,
    user: cfg.lastfm.user || '',
    apiKey: cfg.lastfm.apiKey || '',
    pollMin: cfg.lastfm.pollMin || 2,
    idleMin: cfg.lastfm.idleMin || 12,
    listening,
  }) : null;

  let phoneTunnel = null;
  let phone = null;
  if (allow('phone') && modPhoneTunnel && cfg.phone && cfg.phone.enabled !== false && cfg.phone.token) {
    phoneTunnel = modPhoneTunnel.createPhoneTunnel({
      port: cfg.phone.port || 3010,
      token: cfg.phone.token,
      heartbeatMs: cfg.phone.heartbeatMs,
      offlineAfterMs: cfg.phone.offlineAfterMs,
    });
    phoneTunnel.start();
    phone = modPhone ? modPhone.createPhone({ ...cfg.phone, tunnel: phoneTunnel, dataDir: cfg.dataDir }) : null;
    console.log('  手持      ' + (phoneTunnel.online ? '在线' : '等手机连进来（端口 ' + (cfg.phone.port || 3010) + '）'));
  } else if (cfg.phone && cfg.phone.enabled !== false) {
    console.log('  手持      没配 token，先不启动');
  }

  const voice = (allow('voice') && modVoice) ? modVoice.createVoice({
    dataDir: cfg.dataDir,
    ...(cfg.voice || {}),
  }) : null;
  if (voice) console.log('  语音      ' + (voice.enabled ? '开（edge-tts / ' + ((cfg.voice && cfg.voice.voice) || 'zh-CN-XiaoyiNeural') + '）' : '关'));

  const mood = allow('mood') ? createMood({
    dataDir: cfg.dataDir,
    ...(cfg.mood || {}),
  }) : null;
  const life = allow('life') ? createLife(cfg.life || {}) : null;

  const profile = (allow('profile') && modProfile) ? modProfile.createProfile({
    memory,
    dataDir: cfg.dataDir,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    ownerIds: cfg.ownerIds,
    config: cfg.profile,
  }) : null;
  if (mood && life) {
    const snap = mood.peek();
    const now = life.current();
    console.log('  状态      ' + snap.mood + '（精力 ' + snap.energy + '/100，耐心 ' + snap.patience + '/100）');
    console.log('  在干嘛    ' + now.doing + (now.busy ? '（手上忙着）' : ''));
    if (profile) console.log('  画像      ' + (profile.render(cfg.ownerIds[0]) ? '有（注入最近 2 个月）' : '还没有（下个月初自动生成）'));
  }

  const waker = new Waker({
    names: cfg.names,
    keywords: cfg.keywords,
    ownerIds: cfg.ownerIds,
    probability: cfg.wake.probability,
    batchWindowMs: cfg.wake.groupWindowMs,
  });

  const pending = new Map();

  const bot = new OneBot({
    ...cfg.onebot,
    onMessage: (msg) => {

      msg.admins = adminsOf(msg.key, cfg);

      if (listening && isAdminIn(msg.key, msg.userId, cfg)) {
        const heard = listening.capture(msg);

        if (heard && !String(msg.text || '').trim()) {
          msg.text = '[分享了一首歌] ' + heard.title + (heard.artist ? ' - ' + heard.artist : '');
        }
      }

      if (!waker.configs.has(msg.key)) {
        waker.setConfig(msg.key, msg.isGroup
          ? groupWakeCfg(msg.key, cfg)
          : { mode: 'active', anyMessage: true });
      }

      const verdict = waker.shouldWake(msg);
      const isOwner = msg.admins.has(String(msg.userId));

      const gtag = msg.isGroup ? '·群' + gidOf(msg.key) : '';
      if (!verdict.wake && !isOwner) {
        if (msg.isGroup) console.log('[静音' + gtag + '] ' + msg.name + '：' + msg.text.slice(0, 40));
        return;
      }
      console.log('[醒·' + (verdict.reason || 'owner') + gtag + '] ' + msg.name + '：' + msg.text.slice(0, 60));

      const win = msg.isGroup ? cfg.wake.groupWindowMs : cfg.wake.privateWindowMs;
      clearTimeout(pending.get(msg.key));
      waker.batch(msg);
      pending.set(msg.key, setTimeout(() => {
        const items = waker.flush(msg.key);
        if (!items.length) return;
        handleTurn({ bot, brain, human, memory, waker, stickers, gallery, listening, phone, voice, mood, life, profile, diaryBook }, items, cfg)
          .catch((e) => console.error('[出错] ' + (e?.message || e)));
      }, win));
    },
  });

  const proactive = allow('proactive') ? createProactive({
    memory,
    brain,
    human,
    bot,
    dataDir: cfg.dataDir,
    ownerIds: cfg.ownerIds,
    config: cfg.proactive,
    life,
    listening,
    mood,
    voice,
  }) : null;
  if (proactive) proactive.start();
  if (diaryBook) diaryBook.start();
  if (lastfm) lastfm.start();

  process.on('unhandledRejection', (e) => console.error('[未处理] ' + (e?.message || e)));
  process.on('SIGINT', () => {
    if (proactive) proactive.stop();
    if (diaryBook) diaryBook.stop();
    if (lastfm) lastfm.stop();
    if (phoneTunnel) phoneTunnel.close();
    console.log('\n再见。');
    process.exit(0);
  });

  setInterval(() => {}, 60000);

  process.on('exit', (code) => {
    console.log('[退出] code=' + code + (code === 0 ? '（不是你按的 Ctrl+C 的话，说明进程自己走到了终点）' : ''));
  });

  console.log('在跑了。Ctrl+C 退出。\n');
}

export async function handleTurn({ bot, brain, human, memory, waker, stickers, gallery, listening, phone, voice, mood, life, profile, diaryBook }, items, cfg) {
  const last = items[items.length - 1];
  const key = last.key;
  const text = Waker.joinBatch(items);
  const phoneImages = [];

  const gcfg = last.isGroup ? groupCfg(key, cfg) : {};
  const galleryOk = !last.isGroup || gcfg.allowGallery === true;
  const base = last.isGroup
    ? '你在一个 QQ 群里。下面是群里刚连着说的几句话，最后一条是最新的。'
    : '你在跟 ' + last.name + ' 私聊。';

  const tips = [
    stickers ? stickers.hint() : '',
    gallery ? (galleryOk ? gallery.hint(text) : '') : '',
    listening ? listening.hint() : '',
    phone ? phone.hint(text) : '',
    voice ? voice.hint(text) : '',

    mood ? mood.hint() : '',
    life ? life.hint() : '',
  ].filter(Boolean).join('\n');
  const situation = tips ? base + '\n' + tips : base;

  const profileText = profile ? profile.render(last.userId) : '';
  const sitFull = [profileText, situation].filter(Boolean).join('\n');
  if (profile) void profile.tick();

  const { text: out0, emoji, imgFile, collect, show } = await brain.reply({ key, userId: last.userId, userName: last.name, text, situation: sitFull });

  let out = out0;
  if (phone) {
    const ph = await phone.run(out);
    out = ph.text;
    if (ph.images && ph.images.length) phoneImages.push(...ph.images);
    if (ph.wantSee) {
      const shot = await phone.screenshot();
      if (shot) {
        try {
          const second = await brain.reply({
            key, userId: last.userId, userName: last.name,
            text: (out || '我看看手机') + '\n（你现在看到的是自己手机的屏幕）',
            situation: sitFull + '\n' + phone.hint(text),
            extraImages: [shot],
            record: false,
          });
          if (second && second.text) out = second.text;

          if (out) {
            const ph2 = await phone.run(out);
            out = ph2.text;
            if (ph2.images && ph2.images.length) phoneImages.push(...ph2.images);
          }
        } catch (e) { console.error('[手机] 看图那轮失败：' + ((e && e.message) || e)); }
      } else {
        out = out || '手机没连上，看不见。';
      }
    }
  }

  if (voice) {
    const v = await voice.run(out, { force: voice.asked(text), key });
    out = v.text;
    if (v.audio) {
      try {
        await bot.send(key, '[CQ:record,file=' + v.audio + ']');
      } catch (e) {
        console.warn('   [语音] 没发出去：' + ((e && e.message) || e));
      }
    }
  }

  let diaryEntry = null;
  let diaryForced = false;
  if (diaryBook && typeof diaryBook.take === 'function') {

    const wantsDiary = typeof diaryBook.wanted === 'function' ? diaryBook.wanted(text) : false;
    const taken = diaryBook.take(out, { force: wantsDiary && !out.includes('[[') });
    if (taken.asked) {
      out = taken.text;
      diaryEntry = taken.entry;
      diaryForced = !!taken.forced;
    }
  }

  const wantsPic = gallery && typeof gallery.wanted === 'function' ? gallery.wanted(text) : false;
  const hasToSend = Boolean(out)
    || (typeof show === 'string' && show)
    || Boolean(emoji)
    || Boolean(diaryEntry)
    || (collect && imgFile && gallery)
    || phoneImages.length > 0;
  if (!hasToSend && !wantsPic) { console.log('   （没说话）'); return; }
  if (!out && wantsPic) console.log('   （她没吭声，但他要图，替她挑一张）');

  if (out) {
    if (mood) mood.after({ text, out });
    if (cfg.dryRun) { console.log('   [干跑] 会说：' + out); return; }

    const r = await human.say(out, {
      setTyping: (on) => bot.setTyping(key, on),
      send: (m) => bot.send(key, m),
    });
    console.log('   发出 ' + r.sent + ' 条：' + r.parts.map((p) => p.slice(0, 18)).join(' | '));
  }

  if (diaryEntry) {
    const d5 = String(diaryEntry.day || '').slice(5);
    const head = ('📖 ' + d5 + ' ' + (diaryEntry.time || '')
      + (diaryEntry.mood ? '（' + diaryEntry.mood + '）' : '')
      + (diaryEntry.title ? '「' + diaryEntry.title + '」' : '')).trim();
    try {
      await bot.send(key, (head + '\n' + diaryEntry.text).trim());
      console.log('   [日记] ' + (diaryForced ? '他想看、她没写标记，替她取出 ' : '把 ')
        + (diaryEntry.day || '') + ' 那篇给他看');

      if (memory && typeof memory.dropPending === 'function') {
        const n = memory.dropPending(last.userId, '日记');
        if (n) console.log('   [日记] 兑现了，从待续里删掉 ' + n + ' 条');
      }
    } catch (e) {
      console.warn('   [日记] 没发出去：' + ((e && e.message) || e));
    }
  }

  if (phoneImages.length && last.isGroup) {
    console.log('   [手机] 群聊不发截图（硬禁），已丢弃 ' + phoneImages.length + ' 张');
  } else {
    for (const uri of phoneImages) {
      try {
        await bot.sendImage(key, uri);
        console.log('   [手机] 截图已发出');
      } catch (e) {
        console.warn('   [手机] 截图没发出去：' + ((e && e.message) || e));
      }
    }
  }

  if (emoji && stickers) {
    const sentSticker = await stickers.send(key, emoji, (f) => bot.sendImage(key, f));
    if (sentSticker) console.log('   [表情] ' + emoji);
  }

  if (collect && gallery && imgFile && galleryOk) {
    const why = collect === 'on' ? out : collect;
    const item = gallery.collect({ srcPath: imgFile, reason: why, from: last.name });
    if (item) console.log('   [收藏] ' + item.file + (item.dup ? '（已有的）' : ' ← ' + item.reason));
  }

  let picSent = false;
  if (typeof show === 'string' && show && gallery && galleryOk) {
    picSent = await gallery.send(key, show, (f) => bot.sendImage(key, f));
    if (picSent) console.log('   [图库] ' + (show || '随便挑一张'));
  }

  if (!picSent && wantsPic && gallery && galleryOk) {
    const guess = typeof gallery.guessKeyword === 'function' ? gallery.guessKeyword(text) : '';
    picSent = await gallery.send(key, guess, (f) => bot.sendImage(key, f));
    if (picSent) console.log('   [图库] 他没说清哪张，替她挑了' + (guess ? '「' + guess + '」' : '一张'));
  }

  waker.wake(key);

}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('启动失败：' + (e?.stack || e)); process.exit(1); });
}
