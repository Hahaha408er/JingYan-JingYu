

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FEATURES = [
  'memory',
  'stickers',
  'gallery',
  'diary',
  'voice',
  'proactive',
  'listen',
  'phone',
  'profile',
  'mood',
  'life',
];

export const FEATURE_NAMES = {
  memory: '记忆',
  stickers: '表情包',
  gallery: '图库',
  diary: '日记',
  voice: '语音',
  proactive: '主动找你',
  listen: '听歌',
  phone: '手机',
  profile: '月度画像',
  mood: '状态',
  life: '生活感',
};

const BASE_DEFAULTS = {
  memory: true,
  stickers: true,
  gallery: true,
  diary: true,
  voice: false,
  proactive: false,
  listen: false,
  phone: false,
  profile: true,
  mood: true,
  life: true,
};

const BASE_PLANS = {

  free: {
    memory: true, stickers: true, gallery: true, diary: false, voice: false,
    proactive: true, listen: false, phone: false, profile: false, mood: true, life: true,
  },
  pro: {
    memory: true, stickers: true, gallery: true, diary: true, voice: true,
    proactive: true, listen: true, phone: true, profile: true, mood: true, life: true,
  },
};

const DEFAULTS = {
  enabled: true,
  file: 'features.json',
};

const NEEDS_FILE = {
  diary: ['diary.js', 'diary-bridge.js'],
  listen: ['listening.js'],
  voice: ['voice.js'],
  phone: ['phone.js', 'phone-tunnel.js'],
  profile: ['profile.js'],
};

function isObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

export function absentFeatures() {
  const src = path.dirname(fileURLToPath(import.meta.url));
  const out = new Set();
  for (const [feat, files] of Object.entries(NEEDS_FILE)) {
    if (!files.every((f) => fs.existsSync(path.join(src, f)))) out.add(feat);
  }
  return out;
}

export function createFeatures({ dataDir, config = {}, log = console } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const file = path.join(dataDir, cfg.file);
  let cache = null;
  let mtime = -1;
  let license = null;

  const absent = absentFeatures();
  if (absent.size) {
    const names = [...absent].map((f) => FEATURE_NAMES[f] || f).join('、');
    log.warn && log.warn('   [功能] 这些功能的模块不在这个包里，开关一律按关处理：' + names);
  }

  readFile();

  function readFile() {
    let st;
    try {
      st = fs.statSync(file);
    } catch {

      return null;
    }
    if (cache && st.mtimeMs === mtime) return cache;
    try {

      const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const j = JSON.parse(txt);
      cache = isObj(j) ? j : null;
      mtime = st.mtimeMs;
      return cache;
    } catch (e) {
      log.warn && log.warn('   [功能] features.json 读不动（' + (e?.message || e) + '），按默认档跑');
      cache = null;
      mtime = st.mtimeMs;
      return null;
    }
  }

  function data() {
    const onDisk = readFile();

    if (!onDisk) {
      const allOn = {};
      for (const f of FEATURES) allOn[f] = true;
      return { defaults: allOn, plans: { ...BASE_PLANS }, users: {} };
    }
    return {
      defaults: isObj(onDisk.defaults) ? { ...BASE_DEFAULTS, ...onDisk.defaults } : { ...BASE_DEFAULTS },
      plans: isObj(onDisk.plans) ? { ...BASE_PLANS, ...onDisk.plans } : { ...BASE_PLANS },
      users: isObj(onDisk.users) ? onDisk.users : {},
    };
  }

  function key(uid) {
    return String(uid == null ? '' : uid).trim();
  }

  function has(uid, feat) {
    if (!cfg.enabled) return true;
    if (!FEATURES.includes(feat)) return true;
    const d = data();
    const u = isObj(d.users[key(uid)]) ? d.users[key(uid)] : {};
    const plan = isObj(d.plans[u.plan]) ? d.plans[u.plan] : null;

    let allow = d.defaults[feat] === true;
    if (plan && typeof plan[feat] === 'boolean') allow = plan[feat];
    if (isObj(u.overrides) && typeof u.overrides[feat] === 'boolean') allow = u.overrides[feat];

    if (license) {
      if (license.expired === true) {

        const free = d.plans.free || BASE_DEFAULTS;
        const freeAllow = free[feat] === true;
        return allow && freeAllow;
      }
      if (Array.isArray(license.features)) {
        return allow && license.features.includes(feat);
      }
    }

    if (absent.has(feat)) return false;
    return allow;
  }

  function list(uid) {
    const on = [];
    const off = [];
    for (const f of FEATURES) (has(uid, f) ? on : off).push(f);
    return { on, off };
  }

  function summary(uid) {
    const { on } = list(uid);
    return on.map((f) => FEATURE_NAMES[f] || f).join(' / ') || '（全关）';
  }

  function write(obj) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(obj, null, 2));
      cache = obj;
      mtime = -1;
      return true;
    } catch (e) {
      log.warn && log.warn('   [功能] 写不进 features.json：' + (e?.message || e));
      return false;
    }
  }

  function init(allOn = false) {
    if (fs.existsSync(file)) return false;
    const d = {};
    for (const f of FEATURES) d[f] = allOn ? true : BASE_DEFAULTS[f] === true;
    return write({ defaults: d, plans: BASE_PLANS, users: {} });
  }

  function setPlan(uid, planName) {
    const d = data();
    d.users[key(uid)] = { ...(isObj(d.users[key(uid)]) ? d.users[key(uid)] : {}), plan: String(planName) };
    return write(d);
  }

  function setFeature(uid, feat, on) {
    if (!FEATURES.includes(feat)) return false;
    const d = data();
    const u = isObj(d.users[key(uid)]) ? d.users[key(uid)] : {};
    u.overrides = { ...(isObj(u.overrides) ? u.overrides : {}), [feat]: on === true };
    d.users[key(uid)] = u;
    return write(d);
  }

  function removeUser(uid) {
    const d = data();
    delete d.users[key(uid)];
    return write(d);
  }

  function applyLicense(lic) {
    license = isObj(lic) ? lic : null;
    return license;
  }

  return {
    has, list, summary, init,
    setPlan, setFeature, removeUser, applyLicense,
    file, FEATURES, FEATURE_NAMES,
    absent,
    get license() { return license; },
  };
}

function isMain() {
  try {
    return pathToFileURL(path.resolve(process.argv[1] || '')).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  const get = (name, def = '') => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : def;
  };
  const dataDir = get('dir', path.resolve(process.cwd(), 'data'));
  const F = createFeatures({ dataDir });

  if (args.includes('--init')) {
    const allOn = args.includes('--all');
    const before = fs.existsSync(F.file);
    const ok = F.init(allOn);
    console.log(before
      ? F.file + ' 已存在，没动它'
      : (ok ? '已生成 ' + F.file + (allOn ? '（全部打开）' : '（免费档：语音/主动/听歌/手机默认关）')
        : '写不进去：' + F.file + '（目录权限？）'));
  } else if (args.includes('--list')) {
    const uid = get('user');
    if (uid) {
      console.log('用户 ' + uid + '：' + F.summary(uid));
      const { on, off } = F.list(uid);
      console.log('  开：' + on.join(' '));
      console.log('  关：' + off.join(' '));
    } else {
      console.log('功能位：' + FEATURES.join(' '));
      console.log('用法：node src/features.js --list --user 100000001');
    }
  } else if (args.includes('--plan')) {
    const user = get('user');
    const plan = get('plan');
    if (!user || !plan) {
      console.log('用法：node src/features.js --user 100000001 --plan pro');
    } else {
      console.log(F.setPlan(user, plan) ? '已设置 ' + user + ' → ' + plan : '写入失败');
    }
  } else if (args.includes('--set')) {
    const user = get('user');
    const setIdx = args.indexOf('--set');
    const feat = get('feature') || args[setIdx + 1] || '';
    const val = get('on', '1');
    const on = !['0', 'false', 'off', 'no'].includes(String(val).toLowerCase());
    if (!user || !feat) {
      console.log('用法：node src/features.js --user 100000001 --set voice --on 0');
    } else {
      console.log(F.setFeature(user, feat, on) ? '已设置 ' + user + ' ' + feat + ' = ' + on : '功能位不存在或写入失败');
    }
  } else {
    console.log([
      '功能位管理：',
      '  node src/features.js --init                              # 生成 data/features.json 模板',
      '  node src/features.js --user 100000001 --list             # 看这个人开了什么',
      '  node src/features.js --user 100000001 --plan pro         # 套用套餐',
      '  node src/features.js --user 100000001 --set voice --on 0 # 单项覆盖',
      '',
      '功能位：' + FEATURES.join(' '),
    ].join('\n'));
  }
}
