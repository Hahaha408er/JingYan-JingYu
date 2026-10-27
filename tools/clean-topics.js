#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const dirArg = argv.indexOf('--dir');
const DATA_DIR =
  dirArg >= 0 && argv[dirArg + 1]
    ? path.resolve(argv[dirArg + 1])
    : path.resolve(HERE, '..', 'data');

const DIRTY = /\[CQ:|file=|\[图片\]|\[表情\]/;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' + p(d.getMonth() + 1) +
    '-' + p(d.getDate()) +
    '-' + p(d.getHours()) +
    '-' + p(d.getMinutes()) +
    '-' + p(d.getSeconds())
  );
}

function main() {
  const file = path.join(DATA_DIR, 'people.json');
  if (!fs.existsSync(file)) {
    console.log('找不到 ' + file + ' —— 确认 --dir 指到的是 companion 的数据目录');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log('people.json 解析失败：' + e.message);
    process.exit(1);
  }

  console.log('数据文件 ' + file);
  console.log('模式     ' + (APPLY ? '真删（会先备份）' : '预览（不写文件）'));
  console.log('');

  let totalTopics = 0;
  let totalDirty = 0;
  const plan = [];

  for (const id of Object.keys(data)) {
    const p = data[id] || {};
    const topics = Array.isArray(p.topics) ? p.topics : [];
    const dropped = topics.filter((t) => DIRTY.test(String(t)));
    totalTopics += topics.length;
    totalDirty += dropped.length;
    if (dropped.length) plan.push({ id, name: p.name || '', dropped });
  }

  for (const item of plan) {
    console.log('· ' + (item.name || item.id) + '（' + item.id + '）删 ' + item.dropped.length + ' 条：');
    for (const t of item.dropped) console.log('    - ' + String(t).slice(0, 70));
  }

  if (!totalDirty) {
    console.log('没有需要清理的话题（共 ' + totalTopics + ' 条，全部干净）');
    return;
  }

  console.log('');
  console.log('小结：一共 ' + totalTopics + ' 条话题，其中 ' + totalDirty + ' 条含 CQ 码/图片文件名');

  if (!APPLY) {
    console.log('');
    console.log('这是预览，没有改动任何文件。确认无误后加 --apply 执行：');
    console.log('  node tools/clean-topics.js --apply');
    return;
  }

  const backup = path.join(DATA_DIR, 'people-' + stamp() + '.json');
  fs.copyFileSync(file, backup);
  console.log('');
  console.log('已备份 -> ' + backup);

  for (const item of plan) {
    data[item.id].topics = (data[item.id].topics || []).filter((t) => !DIRTY.test(String(t)));
  }

  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

  let left = 0;
  for (const id of Object.keys(data)) left += (data[id].topics || []).length;
  console.log('已写入 ' + file);
  console.log('清理后话题总数：' + left + '（删掉 ' + totalDirty + ' 条）');
  console.log('想反悔：把备份文件复制回去 —— cp "' + backup + '" "' + file + '"');
}

main();
