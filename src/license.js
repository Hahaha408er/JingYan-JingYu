

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PUB_FILE = path.join(HERE, 'license-pub.pem');

export const TIER_NAMES = { base: '基础档', pro: '进阶档' };

export function readPubKey(pubPath = PUB_FILE) {
  try {
    const s = fs.readFileSync(pubPath, 'utf8');
    return s.includes('BEGIN PUBLIC KEY') ? s : null;
  } catch {
    return null;
  }
}

export function verifyLicense(str, pubPath = PUB_FILE) {
  const raw = String(str || '').trim().replace(/\s+/g, '');
  if (!raw) return { ok: false, reason: '没有授权码' };

  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: '格式不对（应该是 AK1.xxx.yyy）' };
  const [tag, body, sig] = parts;
  if (tag !== 'AK1') return { ok: false, reason: '版本不认识（' + tag + '）' };

  const pub = readPubKey(pubPath);
  if (!pub) return { ok: false, reason: '包里没有公钥 license-pub.pem，没法验签' };

  let buf;
  try {
    buf = Buffer.from(body, 'base64url');
  } catch {
    return { ok: false, reason: '正文不是合法的 base64url' };
  }

  if (buf.toString('base64url') !== body) {
    return { ok: false, reason: '正文的编码不规范（可能被改过）' };
  }

  let good = false;
  let sigBuf;
  try {
    sigBuf = Buffer.from(sig, 'base64url');
    if (sigBuf.toString('base64url') !== sig) {
      return { ok: false, reason: '签名的编码不规范（可能被改过）' };
    }

    good = crypto.verify(null, Buffer.from(tag + '.' + body, 'utf8'), pub, sigBuf);
  } catch (e) {
    return { ok: false, reason: '验签出错：' + ((e && e.message) || e) };
  }
  if (!good) return { ok: false, reason: '签名不对（码被改过，或者不是这份包的公钥签的）' };

  let info;
  try {
    info = JSON.parse(buf.toString('utf8'));
  } catch {
    return { ok: false, reason: '正文不是 JSON' };
  }

  return {
    ok: true,
    raw,
    tier: String(info.tier || 'pro'),
    buyer: String(info.buyer || '（没写名字）'),
    order: String(info.order || ''),

    iat: Number(info.iat || 0) * 1000,
    updateUntil: Number(info.updateUntil || 0) * 1000,
  };
}

export function loadLicense({ dataDir, config, pubPath = PUB_FILE } = {}) {
  const candidates = [];
  if (dataDir) candidates.push({ p: path.join(dataDir, 'license.txt'), src: 'data/license.txt' });
  candidates.push({ p: path.join(HERE, '..', 'LICENSE-ME.txt'), src: 'LICENSE-ME.txt' });

  for (const c of candidates) {
    try {
      const t = fs.readFileSync(c.p, 'utf8').trim();
      if (t) return { ...verifyLicense(t, pubPath), source: c.src };
    } catch {

    }
  }

  const fromCfg = config && (config.license || config.licenseKey);
  if (fromCfg) return { ...verifyLicense(fromCfg, pubPath), source: 'config.license' };

  return { ok: false, reason: '没有授权码（不影响使用）' };
}

const DAY = 86400000;

export function daysLeft(updateUntil, now = Date.now()) {
  if (!updateUntil) return null;
  return Math.ceil((updateUntil - now) / DAY);
}

const fmtDate = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

export function describeLicense(r, now = Date.now()) {
  if (!r || !r.ok) return ' 授权     未激活（不影响使用；进阶包才需要码）';
  const tier = TIER_NAMES[r.tier] || r.tier;
  const who = r.buyer + (r.order ? '，订单 ' + r.order : '');
  const left = daysLeft(r.updateUntil, now);
  if (r.updateUntil && left <= 0) {
    return ' 授权     ' + tier + ' · ' + who + '（更新已于 ' + fmtDate(r.updateUntil) + ' 到期，旧版可继续用）';
  }
  if (r.updateUntil) {
    return ' 授权     ' + tier + ' · ' + who + '（更新至 ' + fmtDate(r.updateUntil) + '，还剩 ' + left + ' 天）';
  }
  return ' 授权     ' + tier + ' · ' + who;
}
