

const WEEK = '日一二三四五六';
const DAY_MS = 24 * 60 * 60 * 1000;

function p2(n) { return String(n).padStart(2, '0'); }

function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

export function clockLabel(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  const hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
  const diff = Math.round((dayStart(new Date()) - dayStart(d)) / DAY_MS);
  if (diff <= 0) return hm;
  if (diff === 1) return '昨天 ' + hm;
  if (diff < 7) return diff + ' 天前 ' + hm;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}

export function gapLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  const m = Math.floor(n / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

function daySegment(h) {
  if (h < 5) return '凌晨';
  if (h < 9) return '早上';
  if (h < 12) return '上午';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 23) return '晚上';
  return '深夜';
}

export function clockBlock(memory, userId) {
  try {
    const now = new Date();
    const h = now.getHours();
    const L = [
      '【现在】',
      '现在是 ' + now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate()
        + ' 日 周' + WEEK[now.getDay()] + ' ' + p2(h) + ':' + p2(now.getMinutes())
        + '（' + daySegment(h) + '）',
    ];

    let p = null;
    try { p = memory?.person?.(userId) || null; } catch { p = null; }

    if (p) {
      const last = Number(p.lastSeenAt) || 0;
      const first = Number(p.firstSeenAt) || 0;

      if (last > 0 && now.getTime() - last > 60 * 1000) {
        L.push('距上次说话：' + gapLabel(now.getTime() - last));
      }
      if (first > 0 && first <= now.getTime()) {
        const days = Math.floor((dayStart(now) - dayStart(new Date(first))) / DAY_MS) + 1;
        if (days >= 2) L.push('你们认识第 ' + days + ' 天');
      }
    }
    return L.join('\n');
  } catch {
    return '';
  }
}

export default { clockLabel, gapLabel, clockBlock };
