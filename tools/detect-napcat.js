#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG = path.join(ROOT, 'config.json');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dry = !apply;
const argVal = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};

function sh(cmd, argv) {
  try {
    return execFileSync(cmd, argv, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

console.log('════════ NapCat 目录探测 ════════');

if (sh('docker', ['--version']).error) {
  console.log('❌ 这台机器上没有 docker（或者当前用户没权限用 docker）。');
  console.log('   如果 NapCat 是用别的方式跑的，手动找一下它的 QQ 配置目录：');
  console.log('     find / -maxdepth 6 -type d -name QQ 2>/dev/null | grep -i napcat');
  console.log('   找到后把它填进 config.json 的 onebot.imageVolume（宿主机路径，末尾不含 /QQ）。');
  process.exit(1);
}

let container = argVal('container');
if (!container) {
  const list = sh('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}']);
  if (list.error) { console.error('❌ docker ps 失败：' + list.error); process.exit(1); }
  const rows = String(list).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const hit = rows.find(([n, img]) => /napcat|napneko|qq/i.test(n + ' ' + img));
  if (!hit) {
    console.log('❌ 没找到像 NapCat 的容器。运行中的容器有：');
    rows.forEach(([n, img]) => console.log('   ' + n + '  (' + img + ')'));
    console.log('   用 --container 指定名字再试一次。');
    process.exit(1);
  }
  container = hit[0];
}
console.log('容器     ' + container);

const mountsRaw = sh('docker', ['inspect', '-f', '{{json .Mounts}}', container]);
if (mountsRaw.error) { console.error('❌ docker inspect 失败：' + mountsRaw.error); process.exit(1); }
let mounts = [];
try { mounts = JSON.parse(mountsRaw); } catch {  }
if (!Array.isArray(mounts) || !mounts.length) {
  console.error('❌ 这个容器没有任何挂载，读不到容器内的文件。');
  process.exit(1);
}

console.log('\n挂载：');
mounts.forEach((m) => console.log('   ' + (m.Destination || '?') + '  ←  ' + (m.Source || '?')));

const prefer = mounts.filter((m) => /\.config\/QQ\/?$/i.test(String(m.Destination || '')));
const fallback = mounts.filter((m) => /napcat|qq/i.test(String(m.Source || '') + String(m.Destination || '')));
const pick = (prefer.length ? prefer : fallback)[0];

if (!pick) {
  console.log('\n❌ 没找到明显的 QQ 配置目录挂载。');
  console.log('   手动确认容器里 QQ 的目录：docker exec ' + container + ' sh -c "ls /app/.config/QQ | head"');
  console.log('   然后把宿主机上对应的目录填进 config.json 的 onebot.imageVolume。');
  process.exit(1);
}

const innerPrefix = String(pick.Destination || '').replace(/\/+$/, '') || '/app/.config/QQ';
const volumeDir = String(pick.Source || '').replace(/\/+$/, '');

const exists = fs.existsSync(volumeDir);
const preview = exists ? fs.readdirSync(volumeDir).slice(0, 6).join(' ') : '';

console.log('\n结果：');
console.log('  容器内前缀  ' + innerPrefix);
console.log('  宿主机目录  ' + volumeDir + (exists ? '  ✅ 存在' : '  ❌ 不存在（可能需要 sudo 才能看）'));
if (preview) console.log('  目录里有：' + preview);

if (!exists) {
  console.log('\n⚠️ 目录读不到，可能原因：');
  console.log('   · 没用 sudo 跑这个脚本（/var/lib/docker/volumes 普通用户读不了）');
  console.log('   · NapCat 用的不是 bind mount 而是 named volume（那 Source 就是对的，只是要 sudo）');
  console.log('  先改成 sudo 再跑一次：sudo node tools/detect-napcat.js --apply');
}

const patch = { onebot: { imageVolume: volumeDir, imagePrefix: innerPrefix } };

if (dry) {
  console.log('\n要写进 config.json 的内容（确认没问题就加 --apply）：');
  console.log(JSON.stringify(patch, null, 2));
  process.exit(0);
}

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
} catch (e) {
  console.error('\n❌ 读不了 config.json：' + e.message);
  console.error('   先跑 install.sh 生成 config.json，或者手动加上这两行。');
  process.exit(1);
}

const stamp = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
})();
const bak = path.join(ROOT, 'config-' + stamp + '.json');
fs.copyFileSync(CONFIG, bak);
console.log('\n已经备份：' + path.basename(bak));

cfg.onebot = { ...(cfg.onebot || {}), ...patch.onebot };
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
console.log('已经写进 config.json：onebot.imageVolume / onebot.imagePrefix');
console.log('\n下一步：重启看她能不能识图');
console.log('  pkill -9 -f "src/index.js"; sleep 1; nohup npm start >> bot.log 2>&1 &');
console.log('  然后在 QQ 里发一张图，日志里应该出现「✅ 成功从服务器本地读取到图片并转码」');
