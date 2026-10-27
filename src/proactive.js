

import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  enabled: true,
  ownerOnly: true,
  checkMinMinutes: 45,
  checkMaxMinutes: 110,
  quietMinutes: 15,
  dailyMax: 6,
  probability: 0.35,
  nightDiscount: false,
  voiceChance: 0.15,
};

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const OPEN_PROMPT = [
  '（现在没人跟你说话。你想主动找他说一句。）',
  '一到两句，短一点，用你自己的语气。',
  '不要提"我主动找你""我先开口"这种话，不要问"在吗""忙吗""睡了没"，不要报时。',
  '如果要提旧事，挑账本里真发生过的，别编。',
].join('\n');

const MATERIAL_RULE = [
  '下面是你手边能用的素材，挑一件就行，也可以都不用，单纯想找他：',
  '优先说你自己的事（你正在干什么、你现在什么状态），其次说他最近在听什么，最后才翻旧账。',
  '素材里如果有歌，可以拿歌当话头，但只说一首，别念歌单，也别问"你怎么在听这个"。',
  '这些只是素材，不要一条条念出来，也不要显得像在汇报。',
].join('\n');

export function createProactive({
  memory,
  brain,
  human,
  bot,
  dataDir,
  ownerIds = [],
  config = {},
  life = null,
  listening = null,
  mood = null,
  voice = null,
  log = console,
}) {
  const cfg = { ...DEFAULTS, ...config };
  const file = path.join(dataDir, 'proactive.json');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let timer = null;
  let stopped = false;

  function readState() {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (s && s.date === todayStr()) return s;
    } catch {

    }
    return { date: todayStr(), count: 0, lastAt: 0, sent: [] };
  }

  function writeState(s) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const out = { ...s, sent: (s.sent || []).slice(-20) };
      fs.writeFileSync(file, JSON.stringify(out, null, 2));
    } catch (e) {
      log.log('   [主动] 状态没存下来：' + (e?.message || e));
    }
  }

  function lastInboundAt(key) {
    try {
      const rows = memory.recentTurns(80, {});
      const mine = rows.filter((r) => String(r.where || '') === key);
      return mine.length ? Number(mine[mine.length - 1].t) || 0 : 0;
    } catch {
      return 0;
    }
  }

  function materials() {
    const out = [];
    try {
      if (life) {
        const cur = life.current();
        const doing = String(cur.doing || '').replace(/^(在|正在)/, '');
        out.push('- 你' + cur.part + '在' + doing + '（' + cur.note + '）');
      }
    } catch {  }
    try {
      if (listening) {
        const now = listening.current() || {};
        const rec = typeof listening.recentSongs === 'function' ? listening.recentSongs(4) : [];
        const fmt = (r) => '《' + r.title + '》' + (r.artist ? '（' + r.artist + '）' : '');
        const others = rec.filter((r) => r.title !== now.title).slice(0, 2);
        if (now.title) {
          const mins = now.at ? Math.round((Date.now() - Number(now.at)) / 60000) : -1;
          const suffix = mins < 0 ? '' : mins < 15 ? '，正放着' : mins < 120 ? '，' + mins + ' 分钟前' : '，今天早些时候';
          const how = now.source === 'lastfm' ? '' : '（他分享给你的）';
          out.push('- 他在听' + fmt(now) + suffix + how);
          if (others.length) out.push('- 他最近还听过' + others.map(fmt).join('、'));
        } else if (rec.length) {

          out.push('- 他最近在听' + rec.slice(0, 3).map(fmt).join('、'));
        }
      }
    } catch {  }
    try {
      if (mood) {
        const s = mood.peek();
        out.push('- 你现在' + s.mood + '（精力 ' + s.energy + '/100）');
      }
    } catch {  }
    return out;
  }

  async function checkNow() {
    if (stopped || !cfg.enabled) return false;

    const owner = String(cfg.ownerOnly ? ownerIds[0] || '' : '');
    if (!owner) return false;
    const key = 'private:' + owner;

    const state = readState();
    if (state.count >= cfg.dailyMax) return false;

    const now = Date.now();
    const lastIn = lastInboundAt(key);

    if (now - lastIn < cfg.quietMinutes * 60000) return false;

    if (state.lastAt && state.lastAt > lastIn) return false;

    let p = cfg.probability;
    const h = new Date().getHours();
    if (cfg.nightDiscount && (h >= 23 || h < 8)) p = p / 2;
    if (Math.random() > p) return false;

    const name = memory.person?.(owner)?.name || '你';
    const mats = materials();
    const situation = mats.length
      ? '（你想主动找他说话。没有人在催你，随便说点你真的想说的。）\n\n' + MATERIAL_RULE + '\n' + mats.join('\n')
      : '（你想主动找他说话。没有人在催你，随便说点你真的想说的。）';
    let out = '';
    try {
      const r = await brain.reply({
        key,
        userId: owner,
        userName: name,
        text: OPEN_PROMPT,
        situation,
        record: false,
      });
      out = String(r?.text || '').trim();
    } catch (e) {
      log.log('   [主动] 想说话失败：' + (e?.message || e));
      return false;
    }
    if (!out) return false;

    let voiceSaid = false;
    if (voice && voice.enabled !== false && Math.random() < cfg.voiceChance) {
      try {
        const v = await voice.run(out, { force: true });
        if (v && v.audio) {
          await bot.setTyping(key, true);
          await sleep(600);
          await bot.send(key, '[CQ:record,file=' + v.audio + ']');
          await bot.setTyping(key, false);
          voiceSaid = true;
          log.log('   [主动·语音] 「' + String(v.said || '').slice(0, 18) + '」');
        }
      } catch (e) {
        log.log('   [主动] 语音没发成，改文字：' + (e?.message || e));
      }
    }

    if (!voiceSaid) {
      try {
        await human.say(out, {
          setTyping: (on) => bot.setTyping(key, on),
          send: (t) => bot.send(key, t),
          sleep,
        });
      } catch (e) {
        log.log('   [主动] 发送失败：' + (e?.message || e));
        return false;
      }
    }

    state.count += 1;
    state.lastAt = Date.now();
    state.sent = state.sent || [];
    state.sent.push({ t: state.lastAt, text: out.slice(0, 60) });
    writeState(state);

    log.log('   [主动] ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
      + ' → ' + out.slice(0, 30) + (mats.length ? '（用了 ' + mats.length + ' 条素材）' : ''));
    return true;
  }

  function nextDelay() {
    const min = Math.max(1, Number(cfg.checkMinMinutes) || 45) * 60000;
    const max = Math.max(min / 60000, Number(cfg.checkMaxMinutes) || 110) * 60000;
    return min + Math.random() * Math.max(0, max - min);
  }

  function schedule(delay) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await checkNow();
      } catch (e) {
        log.log('   [主动] 出错已忽略：' + (e?.message || e));
      }
      schedule(nextDelay());
    }, delay);
    if (timer.unref) timer.unref();
  }

  function start() {
    if (!cfg.enabled) return;
    log.log(
      '  主动    每 ' + cfg.checkMinMinutes + '~' + cfg.checkMaxMinutes + ' 分钟看一次，每天最多 ' +
      cfg.dailyMax + ' 条，只对' + (cfg.ownerOnly ? '主人私聊' : '私聊') + '（' + (ownerIds[0] || '未配主人') + '）',
    );

    schedule(2 * 60000);
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
  }

  return { start, stop, checkNow };
}
