

import fs from 'node:fs';

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function statFile(absPath) {
  try {
    const st = fs.statSync(absPath);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

export function isImageFile(absPath) {
  const st = statFile(absPath);
  if (!st) return false;
  const dot = absPath.lastIndexOf('.');
  return dot > 0 && IMG_EXT.has(absPath.slice(dot).toLowerCase());
}

export function toBase64Uri(absPath, maxMB = 4) {
  const st = statFile(absPath);
  if (!st || !isImageFile(absPath)) return null;
  if (st.size <= 0 || st.size > maxMB * 1024 * 1024) return null;
  try {
    return 'base64://' + fs.readFileSync(absPath).toString('base64');
  } catch {
    return null;
  }
}

export function toFileUri(absPath) {
  const st = statFile(absPath);
  if (!st) return null;
  const p = String(absPath).replace(/\\/g, '/');
  return 'file://' + (p.startsWith('/') ? p : '/' + p);
}

export async function sendImageFile({ sendImage }, absPath, { mode = 'base64', maxMB = 4 } = {}) {
  if (typeof sendImage !== 'function') return false;
  const order = mode === 'file' ? ['file', 'base64'] : ['base64', 'file'];
  for (const m of order) {
    const file = m === 'base64' ? toBase64Uri(absPath, maxMB) : toFileUri(absPath);
    if (!file) continue;
    try {
      const r = await sendImage(file);
      if (r && r.ok) return true;

    } catch {

    }
  }
  return false;
}

export default { isImageFile, toBase64Uri, toFileUri, sendImageFile };
