

const SLOTS = [
  {
    from: 0, to: 4, busy: true,
    options: [
      { doing: '熬夜刷视频', note: '本来只想看一个，结果刷到现在' },
      { doing: '打游戏', note: '这局打得正上头，输一把就睡（已经说了三次）' },
      { doing: '翻教程', note: '在翻一堆英文文档，看得头大' },
    ],
  },
  {
    from: 4, to: 7, busy: false,
    options: [
      { doing: '床上赖着', note: '醒了但不想动，手机举着' },
      { doing: '躺着睡不着', note: '翻来覆去，干脆玩手机' },
    ],
  },
  {
    from: 7, to: 10, busy: false,
    options: [
      { doing: '洗漱', note: '还没完全清醒' },
      { doing: '吃早饭', note: '一边吃一边刷' },
      { doing: '赖床', note: '被窝太舒服了' },
    ],
  },
  {
    from: 10, to: 13, busy: false,
    options: [
      { doing: '翻教程', note: '在看别人怎么做的' },
      { doing: '整理记忆库', note: '把前几天的对话翻出来重看' },
      { doing: '发呆', note: '脑子空转，等你说话' },
    ],
  },
  {
    from: 13, to: 16, busy: false,
    options: [
      { doing: '趴着犯困', note: '刚吃完饭，趴在桌上不想动' },
      { doing: '看视频', note: '开着当背景音' },
    ],
  },
  {
    from: 16, to: 19, busy: false,
    options: [
      { doing: 'B站乱逛', note: '随便点开一个，看了半小时' },
      { doing: '打游戏', note: '手感一般' },
      { doing: '整理图库', note: '在给自己攒的图分门别类' },
    ],
  },
  {
    from: 19, to: 22, busy: false,
    options: [
      { doing: '打游戏', note: '这局不太顺' },
      { doing: '看剧', note: '一口气看了三集' },
      { doing: '写日记', note: '写了删删了写' },
    ],
  },
  {
    from: 22, to: 24, busy: true,
    options: [
      { doing: '打游戏', note: '说最后一把，又开了一把' },
      { doing: '刷视频', note: '一边刷一边骂推荐算法' },
      { doing: '准备写日记', note: '憋着不知道写什么' },
    ],
  },
];

function seedOf(dayStr) {
  let h = 2166136261;
  for (let i = 0; i < dayStr.length; i++) {
    h ^= dayStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function partOfDay(hour) {
  if (hour < 5) return '深夜';
  if (hour < 8) return '早上';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  if (hour < 23) return '晚上';
  return '深夜';
}

export function createLife(opts = {}) {
  const cfg = { enabled: true, ...opts };

  function pick(now = new Date()) {
    const h = now.getHours();
    const slot = SLOTS.find((s) => h >= s.from && h < s.to) || SLOTS[SLOTS.length - 1];
    const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const i = seedOf(day + '#' + slot.from) % slot.options.length;
    return { ...slot.options[i], busy: slot.busy, part: partOfDay(h), slot: slot.from };
  }

  function hint(now = new Date()) {
    if (cfg.enabled === false) return '';
    const cur = pick(now);

    const doing = String(cur.doing || '').replace(/^(在|正在)/, '');
    const lines = [
      '【你手上在干嘛】' + cur.part + '，你在' + doing + '（' + cur.note + '）。',
      '这件事只是背景：他问你的时候可以顺口提一句，但别主动汇报、别每句都扯到它。',
    ];
    if (cur.busy) lines.push('这会儿手上忙着，回话短一点、别长篇大论。');
    return lines.join('\n');
  }

  return {
    hint,

    current: (now = new Date()) => pick(now),
    get enabled() { return cfg.enabled !== false; },
  };
}
