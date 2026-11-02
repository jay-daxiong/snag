/**
 * moderation.js — 内容机审前置（发布闲置前自动过滤）
 *
 * 设计目标：
 *  - 纯本地、零依赖、可离线运行，上架前先把明显违规内容拦在门外。
 *  - 分级处理：
 *      block  → 直接拒绝发布（违法违禁、诈骗赌博、色情等硬性红线）
 *      review → 进入「待人工审核」(pending_review)，不立即公开，并自动生成一条机审举报
 *      pass   → 正常发布
 *  - 可扩展：生产可把 SNAG_MOD_API / SNAG_MOD_KEY 接到阿里云/腾讯云内容安全 API，
 *    本模块保留统一入口 moderate()，接入真 API 时只需在内部优先调用远端即可。
 */

// 各风险类别与命中级别。词库刻意保守，尽量降低误伤（避免把正常闲置描述误拦）。
const GROUPS = {
  // 硬性违法违禁 —— 直接拦截
  contraband: {
    level: 'block',
    words: ['冰毒', '海洛因', '大麻', '摇头丸', '可卡因', '管制刀具', '枪支', '弹药',
      '假币', '假证', '野生动物', '穿山甲', '象牙', '虎骨', '人体器官'],
  },
  // 诈骗 / 赌博 / 黑色产业 —— 直接拦截
  fraud: {
    level: 'block',
    words: ['网络赌博', '博彩', '时时彩', '私彩', '刷单返利', '刷单赚钱', '高利贷',
      '套路贷', '裸聊敲诈', '出售银行卡', '出售对公账户', '洗钱', '跑分'],
  },
  // 色情低俗 —— 直接拦截
  porn: {
    level: 'block',
    words: ['裸聊', '约炮', '黄色视频', '色情网站', '成人影片', '性服务'],
  },
  // 政治敏感 —— 转人工审核（宁可慢不可错）
  political: {
    level: 'review',
    words: ['台独', '港独', '疆独', '藏独', '反动'],
  },
  // 辱骂攻击 —— 转人工审核
  abuse: {
    level: 'review',
    words: ['傻逼', '妈的', '操你', '去死吧', '废物', '贱人'],
  },
  // 引流 / 外部交易（免费送场景常见骗术：诱导加微信/QQ 私下交易）
  spam: {
    level: 'review',
    words: ['加我微信', '加微信', '威信', '薇信', '加微', 'v信', 'qq群', '企鹅号',
      '私聊我', '扫码加', '兼职刷单', '代购微信', '私下交易', '不走平台'],
  },
};

// 外部联系方式正则（手机号 / 微信号 / QQ 号）—— 命中转人工审核，防私下诈骗
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const URL_RE = /(https?:\/\/|www\.)/i;

function moderate(text) {
  const t = String(text || '');
  const hits = [];

  for (const cat of Object.keys(GROUPS)) {
    const g = GROUPS[cat];
    for (const w of g.words) {
      if (t.indexOf(w) !== -1) hits.push({ cat, word: w, level: g.level });
    }
  }

  if (PHONE_RE.test(t)) hits.push({ cat: 'leak', word: '(手机号)', level: 'review' });
  if (URL_RE.test(t)) hits.push({ cat: 'leak', word: '(外链)', level: 'review' });

  let level = 'pass';
  if (hits.some((h) => h.level === 'block')) level = 'block';
  else if (hits.length) level = 'review';

  return { level, hits, text: t.slice(0, 200) };
}

/** 对一条闲置的多个字段做综合机审 */
function moderateListing(fields) {
  return moderate([fields.title, fields.desc, fields.address, fields.condition]
    .filter(Boolean).join(' '));
}

module.exports = { moderate, moderateListing, GROUPS };
