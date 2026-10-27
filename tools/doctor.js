#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGV = process.argv.slice(2);
const ROOT_IDX = ARGV.indexOf('--root');
const ROOT = ROOT_IDX >= 0 && ARGV[ROOT_IDX + 1] ? path.resolve(ARGV[ROOT_IDX + 1]) : path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');
const DATA = path.join(ROOT, 'data');
const ARGS = new Set(ARGV);
const FIX = ARGS.has('--fix');
const JSON_OUT = ARGS.has('--json');

const PENDING_MAX = 6;
const PENDING_TTL_DAYS = 10;
const DUP_RATIO = 0.62;

const report = [];
const add = (level, title, detail) => report.push({ level, title, detail: detail || '' });

const CORE = [
  'src/index.js', 'src/brain.js', 'src/memory.js', 'src/role.js', 'src/humanize.js',
  'src/wake.js', 'src/transport-onebot.js', 'src/clock.js', 'src/stickers.js',
  'src/gallery.js', 'src/media.js', 'src/digest.js', 'src/extract.js',
  'src/mood.js', 'src/life.js', 'src/proactive.js', 'src/features.js',
  'role.md',
];

const PRO_MODULES = [
  'src/diary.js', 'src/diary-author.js', 'src/diary-bridge.js',
  'src/listening.js', 'src/lastfm.js', 'src/voice.js', 'src/profile.js',
  'src/phone.js', 'src/phone-tunnel.js',
];

const isProBuild = () => PRO_MODULES.some((f) => stat(path.join(ROOT, f)))
  || stat(path.join(ROOT, 'presets', 'pro'));

const readJson = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};
const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };
const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB');
const norm = (s) => String(s || '').replace(/[\s，。！？、,.!?~…；;：:""''「」『』（）()]/g, '');
const grams = (s) => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
const dice = (a, b) => {
  if (!a || !b) return a === b ? 1 : 0;
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return (2 * hit) / (A.size + B.size);
};
const noteText = (x) => (typeof x === 'string' ? x : String((x && x.t) || ''));
const noteAt = (x) => (x && typeof x === 'object' && Number(x.at)) ? Number(x.at) : 0;

function checkEnv() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) add('fail', 'Node 版本', '现在是 v' + process.versions.node + '，需要 ≥ 18（20+ 更好）');
  else add('ok', 'Node 版本', 'v' + process.versions.node + ' @ ' + process.execPath);

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    add('fail', '依赖目录', '没有 node_modules —— 先装依赖：npm install --omit=dev（或者直接 bash install.sh）');
  } else {
    const wsOk = fs.existsSync(path.join(ROOT, 'node_modules', 'ws'));
    add(wsOk ? 'ok' : 'fail', '依赖 ws', wsOk ? '已安装（Node 24 下必须用它连 NapCat）' : '没装 —— npm install --omit=dev');
  }
}

function checkFiles() {
  const missCore = CORE.filter((f) => !stat(path.join(ROOT, f)));
  if (!missCore.length) add('ok', '核心文件', CORE.length + ' 个全在');
  else add('fail', '核心文件', '缺 ' + missCore.length + ' 个：' + missCore.join('、'));

  if (!stat(path.join(ROOT, 'config.json'))) {
    add('warn', '配置文件', '还没有 config.json（跑一次 install.sh 就会从 config.example.json 生成）');
  } else {
    add('ok', '配置文件', 'config.json 已存在');
  }

  const missPro = PRO_MODULES.filter((f) => !stat(path.join(ROOT, f)));
  if (isProBuild()) {
    if (!missPro.length) add('ok', '进阶模块', PRO_MODULES.length + ' 个全在（这个包是进阶版）');
    else add('fail', '进阶模块', '缺 ' + missPro.length + ' 个：' + missPro.join('、') + '（这个包看着是进阶版，但文件不全，重新解压一次）');
  } else {
    add('info', '进阶模块', '基础版：' + PRO_MODULES.length + ' 个进阶模块不在（正常，对应功能会自动关闭）');
  }
}

function checkSyntax() {
  const files = [];
  for (const dir of ['src', 'tools', 'agent']) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.js') || f.endsWith('.mjs')) files.push(path.join(d, f));
  }
  const bad = [];
  let skipped = 0;
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.error) { skipped++; continue; }
    if (r.status !== 0) {
      const line = String(r.stderr || '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '有语法错误';
      bad.push(path.relative(ROOT, f) + '：' + line);
    }
  }
  if (bad.length) add('fail', '语法检查', bad.length + ' 个文件有问题：\n      ' + bad.join('\n      '));
  else if (skipped) add('warn', '语法检查', '子进程起不来（' + skipped + ' 个跳过），依赖装好后"模块加载"那节会兜住');
  else add('ok', '语法检查', files.length + ' 个文件全部通过');
}

async function checkImports() {
  if (!fs.existsSync(SRC)) { add('ok', '模块加载', '跳过（没有 src 目录）'); return; }

  const hasWs = fs.existsSync(path.join(ROOT, 'node_modules', 'ws'));
  if (!hasWs) {
    add('info', '模块加载', '跳过（等依赖装好再看）');
    return;
  }

  const skip = new Set(['index.js']);
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && !skip.has(f));
  const bad = [];
  for (const f of files) {
    try {
      await import(pathToFileURL(path.join(SRC, f)).href);
    } catch (e) {
      bad.push(f + '：' + ((e && e.message) || e));
    }
  }
  if (!bad.length) add('ok', '模块加载', files.length + ' 个模块都能 import');
  else add('fail', '模块加载', bad.length + ' 个加载失败：\n      ' + bad.join('\n      '));
}

function checkData() {
  const people = readJson(path.join(DATA, 'people.json'));
  if (!people) {
    add('warn', '账本', 'data/people.json 读不到（第一次启动会自己建，可忽略）');
  } else {
    const ids = Object.keys(people);
    const lines = ids.map((k) => {
      const p = people[k] || {};
      return (p.name || k) + ' 事实' + (p.facts || []).length + '/印象' + (p.traits || []).length
        + '/待续' + (p.pending || []).length + '/话题' + (p.topics || []).length;
    });
    add('ok', '账本', ids.length + ' 人：' + lines.join('；'));
  }

  const turns = path.join(DATA, 'turns.jsonl');
  const st = stat(turns);
  if (st) {
    const n = fs.readFileSync(turns, 'utf8').split('\n').filter(Boolean).length;
    add('ok', '对话流', 'turns.jsonl ' + n + ' 行 / ' + kb(st.size));
  } else add('warn', '对话流', '还没有 turns.jsonl（没聊过天？）');

  const days = path.join(DATA, 'days');
  const dayFiles = fs.existsSync(days) ? fs.readdirSync(days).filter((f) => f.endsWith('.json')) : [];
  add(dayFiles.length ? 'ok' : 'warn', '日摘要', dayFiles.length + ' 天');

  const diary = path.join(DATA, 'diary');
  const diaryFiles = fs.existsSync(diary) ? fs.readdirSync(diary).filter((f) => f.endsWith('.md')) : [];
  add(diaryFiles.length ? 'ok' : 'warn', '日记', diaryFiles.length + ' 篇');

  const gal = readJson(path.join(DATA, 'gallery', 'index.json'));
  if (gal) add('ok', '图库', (gal.items || []).length + ' 张');
  const sti = readJson(path.join(DATA, 'stickers', 'index.json'));
  if (sti) add('ok', '表情包', (sti.items || []).length + ' 张 / ' + (sti.tags || []).join(' '));

  const lis = readJson(path.join(DATA, 'listening.json'));
  add('ok', '在听', lis && lis.title ? lis.title + (lis.artist ? ' - ' + lis.artist : '') : '（没记录）');
}

function pendingFindings() {
  const people = readJson(path.join(DATA, 'people.json'));
  if (!people) return { dups: [], stale: [], tooMany: [] };
  const dups = []; const stale = []; const tooMany = [];
  const now = Date.now();
  for (const [id, p] of Object.entries(people)) {
    const arr = Array.isArray(p.pending) ? p.pending : [];
    if (arr.length > PENDING_MAX) tooMany.push((p.name || id) + ' 有 ' + arr.length + ' 条');
    for (const x of arr) {
      const at = noteAt(x);
      if (at && now - at > PENDING_TTL_DAYS * 86400e3) {
        stale.push((p.name || id) + '「' + noteText(x).slice(0, 24) + '」' + Math.round((now - at) / 86400e3) + ' 天前');
      }
    }
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = noteText(arr[i]); const b = noteText(arr[j]);
        if (a === b || a.includes(b) || b.includes(a) || dice(norm(a), norm(b)) >= DUP_RATIO) {
          const atA = noteAt(arr[i]); const atB = noteAt(arr[j]);
          dups.push((p.name || id) + '「' + a.slice(0, 20) + '」≈「' + b.slice(0, 20) + '」'
            + (atA && atB ? '（' + (atA <= atB ? '前者' : '后者') + '旧）' : ''));
        }
      }
    }
  }
  return { dups, stale, tooMany };
}

function checkPending() {
  const { dups, stale, tooMany } = pendingFindings();
  if (dups.length) add('warn', '待续·重复', dups.length + ' 对几乎一样的：\n      ' + dups.slice(0, 8).join('\n      '));
  else add('ok', '待续·重复', '没有重复条目');
  if (stale.length) add('warn', '待续·超期', stale.length + ' 条超过 ' + PENDING_TTL_DAYS + ' 天：\n      ' + stale.slice(0, 8).join('\n      '));
  else add('ok', '待续·超期', '没有超过 ' + PENDING_TTL_DAYS + ' 天的条目');
  if (tooMany.length) add('warn', '待续·太多', tooMany.join('；') + '（建议 ≤ ' + PENDING_MAX + ' 条）');
  else add('ok', '待续·条数', '都在 ' + PENDING_MAX + ' 条以内');
}

function checkBackups() {
  const junk = [];
  for (const dir of ['src', 'data', 'agent', 'tools']) {
    const d = path.join(ROOT, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (/-\d{4}-\d{2}-\d{2}[-\d_]*\.js$/.test(f) || /^people-\d{4}-\d{2}-\d{2}-.*\.json$/.test(f)) {
        junk.push(dir + '/' + f);
      }
    }
  }
  if (!junk.length) add('ok', '备份文件', '没有堆积');
  else add('warn', '备份文件', junk.length + ' 个（不影响运行，发版时要排除）：\n      ' + junk.slice(0, 10).join('\n      ')
    + (junk.length > 10 ? '\n      …还有 ' + (junk.length - 10) + ' 个' : '')
    + '\n      想清就自己删，脚本不替你删：rm ' + junk[0] + '（留下最近一份）');
}

function checkConfig() {
  const c = readJson(path.join(ROOT, 'config.json'));
  if (!c) { add('fail', 'config.json', '读不出来或不是合法 JSON'); return; }
  const key = String(c.apiKey || '').trim();
  if (!key) add('fail', 'API Key', 'apiKey 是空的');
  else if (/xxx|你的|请填|sk-\.\.\./i.test(key) || key.length < 20) add('warn', 'API Key', '看起来像示例值，确认一下');
  else add('ok', 'API Key', '已填（' + key.slice(0, 8) + '…）');

  const ob = c.onebot || {};
  add(ob.wsUrl && ob.httpUrl ? 'ok' : 'fail', 'OneBot', (ob.wsUrl || '(缺 wsUrl)') + ' / ' + (ob.httpUrl || '(缺 httpUrl)'));

  const owners = Array.isArray(c.ownerIds) ? c.ownerIds.filter(Boolean) : [];
  add(owners.length ? 'ok' : 'warn', '主人 QQ', owners.length ? owners.join('、') : 'ownerIds 是空的（私聊不会主动、账本也不分人）');

  const lf = c.lastfm || {};
  if (!lf.enabled) add('ok', 'Last.fm', '没开（分享卡片照旧可用）');
  else if (!lf.user || !lf.apiKey) add('warn', 'Last.fm', '开了但 user/apiKey 没填全');
  else add('ok', 'Last.fm', lf.user + '，每 ' + (lf.pollMin || 2) + ' 分钟问一次');

  const feat = readJson(path.join(DATA, 'features.json'));
  if (!feat) add('ok', '功能开关', '没有 features.json = 全开');
  else {
    const off = Object.entries(feat.features || {}).filter(([, v]) => v === false).map(([k]) => k);
    add('ok', '功能开关', off.length ? '关着：' + off.join('、') : '全开');
  }
}

function checkProcess() {
  const r = spawnSync('pgrep', ['-af', 'node src/index.js'], { encoding: 'utf8' });
  const all = String(r.stdout || '').split('\n').filter((x) => x.includes('node src/index.js'));

  const real = all.filter((line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[1] || '';
    return !/(^|\/)sh$/.test(cmd) && !/^-c$/.test(cmd);
  });
  if (!real.length) add('warn', '进程', '现在没有在跑（要启动就 nohup npm start）');
  else if (real.length === 1) add('ok', '进程', '1 个在跑（PID ' + real[0].trim().split(/\s+/)[0] + '）');
  else add('warn', '进程', real.length + ' 个 node 在跑，可能双开（会导致回复两遍）：\n      ' + real.join('\n      '));
}

function fixPending() {
  const file = path.join(DATA, 'people.json');
  const people = readJson(file);
  if (!people) { add('fail', '修复', '读不到 people.json，没动'); return; }
  const now = Date.now();
  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const bak = path.join(DATA, 'people-' + stamp.getFullYear() + '-' + pad(stamp.getMonth() + 1) + '-'
    + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + '-' + pad(stamp.getMinutes()) + '-' + pad(stamp.getSeconds()) + '.json');

  let dropped = 0; let merged = 0;
  for (const p of Object.values(people)) {
    let arr = Array.isArray(p.pending) ? p.pending.slice() : [];
    const before = arr.length;

    arr = arr.filter((x) => {
      const at = noteAt(x);
      return !(at && now - at > PENDING_TTL_DAYS * 86400e3);
    });

    const kept = [];
    for (const x of arr) {
      const s = noteText(x);
      const hit = kept.findIndex((k) => {
        const o = noteText(k);
        return o === s || o.includes(s) || s.includes(o) || dice(norm(o), norm(s)) >= DUP_RATIO;
      });
      if (hit < 0) { kept.push(x); continue; }
      merged += 1;
      const cur = kept[hit];
      if (noteAt(x) > noteAt(cur)) kept[hit] = x;
    }

    while (kept.length > PENDING_MAX) kept.shift();
    dropped += before - kept.length;
    p.pending = kept;
  }

  if (!dropped) { add('ok', '修复', '待续已经是干净的，没动文件'); return; }
  if (ARGS.has('--dry')) {
    add('ok', '修复（演练）', '会处理 ' + (dropped + merged) + ' 条（合并 ' + merged + ' / 删减 ' + dropped + '），没写文件');
    return;
  }
  try {
    fs.copyFileSync(file, bak);
    fs.writeFileSync(file, JSON.stringify(people, null, 2), 'utf8');
  } catch (e) {
    add('fail', '修复', '写不进去（' + ((e && e.code) || e) + '）：' + ((e && e.message) || '') + '\n      手动跑一次或检查 data/ 权限');
    return;
  }
  add('ok', '修复', '处理 ' + (dropped + merged) + ' 条（合并 ' + merged + ' / 删减 ' + dropped + '）\n      备份：data/' + path.basename(bak)
    + '\n      恢复：cp data/' + path.basename(bak) + ' data/people.json');
}

const ICON = { ok: '  ✅', warn: '  ⚠️', fail: '  ❌', info: '  ⏸ ' };

checkEnv();
checkFiles();
checkSyntax();
await checkImports();
checkConfig();
checkData();
checkPending();
checkBackups();
checkProcess();
if (FIX) fixPending();

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('\n========== 鲸言鲸语体检（' + ROOT + '） ==========\n');
  for (const r of report) {
    console.log(ICON[r.level] + ' ' + r.title + (r.detail ? '：' + r.detail : ''));
  }
  const fail = report.filter((r) => r.level === 'fail').length;
  const warn = report.filter((r) => r.level === 'warn').length;
  console.log('\n---------- 总结 ----------');
  if (fail) console.log('❌ ' + fail + ' 项必须修；⚠️ ' + warn + ' 项建议看看');
  else if (warn) console.log('✅ 没有硬错误；⚠️ ' + warn + ' 项建议看看（多数不影响运行）');
  else console.log('✅ 全部正常');
  if (!FIX) console.log('（想顺手清理重复/超期的待续：node tools/doctor.js --fix）');
  console.log('');
}
process.exit(report.some((r) => r.level === 'fail') ? 1 : 0);
