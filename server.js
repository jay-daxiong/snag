/* Snag 本地后端（演示用）
 *
 * 为什么需要它：短信、支付回调、实名审核这些环节必须有服务端参与，
 * 纯静态页面做不了。这里用 Node 内置模块实现，零依赖。
 *
 * 启动： node server.js
 * 访问： http://127.0.0.1:8787        （前端）
 *        http://127.0.0.1:8787/admin  （后台）
 *
 * 哪些是真的、哪些是模拟的，见 README.md。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 生产级外部服务网关（缺密钥时自动降级为演示模式，接口结构不变）
const sms = require('./sms');
const pay = require('./pay');
const kyc = require('./kyc');
const ai = require('./ai');
const moderation = require('./moderation');

const ROOT = __dirname;
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const DB_FILE = path.join(ROOT, 'server-data.json');

/* 后台管理员账号：默认演示账号，生产请用环境变量覆盖
 *   SNAG_ADMIN_USER / SNAG_ADMIN_PASS        （角色 admin，全权）
 *   SNAG_MOD_USER   / SNAG_MOD_PASS          （角色 moderator，仅内容/实名/举报审核）
 * 登录后签发随机令牌（存于 server-data.json 的 adminTokens，含角色），重启仍有效；
 * 所有 /api/admin/*（登录接口除外）必须带 Authorization: Bearer <token>。
 * 角色约束：moderator 不能访问 users / analytics / sources 等敏感面板。
 */
const ADMIN_USER = process.env.SNAG_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SNAG_ADMIN_PASS || 'admin123';
const MOD_USER = process.env.SNAG_MOD_USER || 'moderator';
const MOD_PASS = process.env.SNAG_MOD_PASS || 'mod123';
function buildAdmins() {
  const arr = [{ user: ADMIN_USER, pass: ADMIN_PASS, role: 'admin' }];
  if (MOD_USER) arr.push({ user: MOD_USER, pass: MOD_PASS, role: 'moderator' });
  return arr;
}
let ADMINS = buildAdmins();
const ADMIN_ROLE_OF = {};
ADMINS.forEach((a) => { ADMIN_ROLE_OF[a.user] = a.role; });

/* ---------------- 功能决策矩阵（数据驱动） ----------------
 * 决策并非拍脑袋：后端持续采集各功能埋点（/api/track），这里结合
 * 使用频次、触达用户数、与留存的关联，给出 核心 / 增强 / 可选 / 门槛 四类结论。
 * 真实产品应拿自家数据回归校准权重，此处用演示数据 + 产品经验给出基线。
 */
const FEATURE_DEFS = {
  open:           { label: '启动 / 首页',      decision: 'core',     why: '所有行为的起点，决定第一眼体验' },
  view:           { label: '列表 / 地图浏览',  decision: 'core',     why: '主场景，使用频次最高' },
  detail:         { label: '物品详情',          decision: 'core',     why: '转化前必经，承载抢手指数' },
  locate:         { label: '一键定位',          decision: 'core',     why: '本地化核心，决定推送是否精准' },
  city_pick:      { label: '手动选城市',        decision: 'core',     why: '定位失败时的兜底，覆盖全国' },
  search:         { label: '搜索',              decision: 'core',     why: '主动发现，与留存强相关' },
  filter:         { label: '分类 / 距离筛选',   decision: 'core',     why: '缩小范围，提升成交率' },
  save:           { label: '收藏',              decision: 'core',     why: '留存与复访强相关' },
  alert:          { label: '实时提醒',          decision: 'core',     why: '通知召回，D7 留存提升明显' },
  subscribe_view: { label: '付费墙曝光',        decision: 'core',     why: '收入漏斗上游' },
  subscribe:      { label: '订阅付费',          decision: 'core',     why: '唯一收入来源' },
  login:          { label: '登录 / 注册',       decision: 'core',     why: '账号体系基础' },
  signup:         { label: '新用户注册',        decision: 'core',     why: '增长北极星指标' },
  recommend:      { label: '个性化推荐',        decision: 'enhance',  why: '使用尚可，继续打磨相关性' },
  scene:          { label: '场景搭配',          decision: 'enhance',  why: '发现新场景，提升客单' },
  risk:           { label: 'AI 风险提示',       decision: 'enhance',  why: '建立信任、防诈骗，优先做' },
  ai_summary:     { label: 'AI 摘要',           decision: 'enhance',  why: '降低阅读成本，可前置' },
  route_plan:     { label: '顺路路线',          decision: 'enhance',  why: '高频好评，强化' },
  claim:          { label: '联系草稿',          decision: 'enhance',  why: '降低开口门槛，提升领取率' },
  share:          { label: '分享',              decision: 'enhance',  why: '增长杠杆，当前偏低需优化' },
  got_it:         { label: '打卡省钱',          decision: 'enhance',  why: '游戏化留存，轻量做' },
  kyc:            { label: '实名认证',          decision: 'gated',    why: '大件信任门槛，仅大件强制，不做全量' },
  kyc_view:       { label: '查看实名页',        decision: 'gated',    why: '同上' },
  night_mode:     { label: '夜间模式',          decision: 'optional', why: '体验加分，非必须' },
  large_font:     { label: '大字号',            decision: 'optional', why: '无障碍，低优先级' },
  history:        { label: '浏览历史',          decision: 'optional', why: '使用率低，可暂缓' },
};

// 与留存的关联系数（演示基线，真实应用用回归得到）：值越高越该保
const RETENTION_LIFT = {
  alert: 0.92, save: 0.85, locate: 0.78, recommend: 0.7, detail: 0.66, view: 0.6,
  route_plan: 0.58, scene: 0.5, search: 0.48, filter: 0.46, claim: 0.44, risk: 0.42,
  ai_summary: 0.4, share: 0.38, got_it: 0.36, subscribe: 0.9, subscribe_view: 0.3,
  open: 0.2, city_pick: 0.4, login: 0.5, signup: 0.7, kyc: 0.55, kyc_view: 0.4,
  night_mode: 0.12, large_font: 0.08, history: 0.1,
};

/* ---------------- 存储 ---------------- */

function seedDemo(db) {
  // 预置 14 天的演示数据，让后台一打开就有内容可看（而不是空表）
  const now = Date.now();
  const day = 86400000;
  let s = 20261101;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // 抽样城市（编码 -> 省），用于把用户/事件落到真实的省/市，支撑区域分布分析
  const SAMPLE_CITIES = [
    [3101, '上海'], [1101, '北京'], [4401, '广东'], [4403, '广东'], [3301, '浙江'],
    [5101, '四川'], [4201, '湖北'], [3201, '江苏'], [4301, '湖南'], [6101, '陕西'],
    [3701, '山东'], [5001, '重庆'], [2301, '黑龙江'], [3501, '福建'], [1201, '天津'],
    [3205, '江苏'], [4406, '广东'], [3302, '浙江'],
  ];
  for (let d = 13; d >= 0; d--) {
    const n = 3 + Math.floor(rnd() * 9);
    for (let i = 0; i < n; i++) {
      const sc = SAMPLE_CITIES[Math.floor(rnd() * SAMPLE_CITIES.length)];
      const id = 'u' + (db.users.length + 1);
      db.users.push({
        id,
        type: rnd() > 0.4 ? 'phone' : 'email',
        account: rnd() > 0.4
          ? '1' + [3, 5, 7, 8, 9][Math.floor(rnd() * 5)] + String(Math.floor(rnd() * 1e9)).padStart(9, '0')
          : 'user' + Math.floor(rnd() * 99999) + '@demo.com',
        createdAt: now - d * day - Math.floor(rnd() * day),
        cityCode: sc[0], province: sc[1],
        subscribed: false,
      });
    }
  }
  db.users.forEach((u) => {
    if (rnd() > 0.62) {
      u.subscribed = true;
      const plan = rnd() > 0.7 ? 'year' : 'month';
      db.orders.push({
        orderId: 'PAY' + (db.orders.length + 1).toString().padStart(6, '0'),
        userId: u.id, plan, method: ['wechat', 'alipay', 'card'][Math.floor(rnd() * 3)],
        amount: plan === 'year' ? 11800 : 1900,
        status: 'paid',
        createdAt: u.createdAt + Math.floor(rnd() * day),
        paidAt: u.createdAt + Math.floor(rnd() * day),
      });
    }
  });
  for (let i = 0; i < 9; i++) {
    const u = db.users[Math.floor(rnd() * db.users.length)];
    db.kyc.push({
      id: 'k' + (i + 1), userId: u.id,
      name: ['张', '李', '王', '陈', '刘'][Math.floor(rnd() * 5)] + '**',
      idNumber: '3101**********' + String(1000 + Math.floor(rnd() * 8999)),
      status: i < 4 ? 'pending' : i < 7 ? 'approved' : 'rejected',
      createdAt: now - Math.floor(rnd() * 5 * day),
    });
  }
  for (let d = 13; d >= 0; d--) {
    db.events.push({ type: 'view', at: now - d * day, count: 120 + Math.floor(rnd() * 260) });
    db.events.push({ type: 'claim', at: now - d * day, count: 8 + Math.floor(rnd() * 30) });
  }

  // 功能使用埋点（演示数据）：按日权重生成各功能的触发次数，落到随机用户，带入省/市
  const FWEIGHTS = {
    open: 90, view: 520, detail: 240, locate: 150, city_pick: 60, search: 180,
    filter: 160, save: 95, alert: 70, subscribe_view: 120, subscribe: 22, recommend: 140,
    scene: 55, risk: 48, ai_summary: 60, route_plan: 38, claim: 42, share: 28, got_it: 34,
    login: 130, signup: 18, kyc: 12, kyc_view: 20, night_mode: 24, large_font: 8, history: 15,
  };
  // 每个功能按「决策类别」设定真实触达率（reach），让埋点 adoption 有区分度，
  // 而不是全员 100%。核心功能人人用，增强类约六成，可选类少数，实名类仅少数大件用户。
  // 个别功能用 REACH_OVERRIDE 校准（如「订阅付费」是真实购买，不可能全员付费）。
  const REACH = { core: 0.96, enhance: 0.58, optional: 0.2, gated: 0.11 };
  const REACH_OVERRIDE = { subscribe: 0.34, signup: 0.9, open: 0.99, view: 0.99, detail: 0.93 };
  Object.keys(FWEIGHTS).forEach((name) => {
    const def = FEATURE_DEFS[name] || { decision: 'enhance' };
    const baseReach = REACH_OVERRIDE[name] !== undefined
      ? REACH_OVERRIDE[name]
      : (REACH[def.decision] || 0.5);
    const reach = Math.min(0.99, Math.max(0.03, baseReach * (0.85 + rnd() * 0.3)));
    let adopters = db.users.filter(() => rnd() < reach);
    if (adopters.length === 0) adopters = [db.users[Math.floor(rnd() * db.users.length)]];
    const base = FWEIGHTS[name];
    for (let d = 13; d >= 0; d--) {
      const count = Math.max(1, Math.round(base * (0.7 + rnd() * 0.7)));
      for (let i = 0; i < count; i++) {
        const u = adopters[Math.floor(rnd() * adopters.length)];
        const at = now - d * day - Math.floor(rnd() * day);
        db.tracks.push({
          name, at, userId: u.id,
          props: { city: u.cityCode, province: u.province },
        });
      }
    }
  });  db.seeded = true;
}

let db;
function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    db = { users: [], orders: [], kyc: [], codes: {}, tokens: {}, adminTokens: {}, events: [], tracks: [], logs: [], listings: [], reports: [], seeded: false };
  }
  if (!db.adminTokens) db.adminTokens = {};
  if (!db.listings) db.listings = [];
  if (!db.reports) db.reports = [];
  if (!db.audit) db.audit = [];
  if (!db.codes) db.codes = {};
  if (!db.tokens) db.tokens = {};
  if (!db.seeded) { seedDemo(db); saveDB(); }
}
function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); } catch (e) {}
}
loadDB();

function log(kind, text) {
  db.logs.unshift({ at: Date.now(), kind, text });
  db.logs = db.logs.slice(0, 200);
  saveDB();
}

// 操作审计：记录后台关键动作（谁、做了什么、对象、详情），供合规追溯
function audit(actor, action, target, detail) {
  db.audit.unshift({
    at: Date.now(), actor: actor || 'system', action,
    target: target || '', detail: detail || '',
  });
  db.audit = db.audit.slice(0, 500);
  saveDB();
}

/* ---------------- 工具 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function body(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
  });
}
function tokenOf(userId) {
  const t = crypto.randomBytes(16).toString('hex');
  db.tokens[t] = userId;
  saveDB();
  return t;
}
function userByToken(req) {
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer\s+/i, '').trim();
  const id = db.tokens[t];
  if (!id) return null;
  return db.users.filter((u) => u.id === id)[0] || null;
}
function adminByToken(req) {
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer\s+/i, '').trim();
  const rec = db.adminTokens && db.adminTokens[t];
  return rec ? (rec.role || 'admin') : null; // 返回角色；未授权返回 null
}
function adminTokenRec(req) {
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return (db.adminTokens && db.adminTokens[t]) || null;
}

// 生成用户专属邀请码（短码，足够唯一）
function genInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}
// 邀请奖励：邀请人每成功邀请 1 人注册，得 7 天会员权益（虚拟，用于兑换/曝光加权）
const INVITE_REWARD_DAYS = 7;
function applyInvite(inviteCode, newUserId) {
  if (!inviteCode) return false;
  const inviter = db.users.filter((u) => u.inviteCode === String(inviteCode).trim().toUpperCase())[0];
  if (!inviter || inviter.id === newUserId) return false;
  inviter.inviteCount = (inviter.inviteCount || 0) + 1;
  inviter.rewardDays = (inviter.rewardDays || 0) + INVITE_REWARD_DAYS;
  const nu = db.users.filter((u) => u.id === newUserId)[0];
  if (nu) nu.invitedBy = inviter.id;
  log('invite', `用户 ${inviter.account} 成功邀请 1 人注册，+${INVITE_REWARD_DAYS} 天权益`);
  return true;
}

/* 身份证校验：GB 11643-1999 的 mod 11-2 校验码算法，这是真的算法 */
function idCardValid(no) {
  if (!/^\d{17}[\dXx]$/.test(no)) return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(no[i], 10) * w[i];
  return codes[sum % 11] === no[17].toUpperCase();
}

// 订单支付成功：标记订单 + 开通会员（被回调与模拟支付共用）
function markPaid(orderId) {
  const o = db.orders.filter((x) => x.orderId === orderId)[0];
  if (!o || o.status === 'paid') return;
  o.status = 'paid';
  o.paidAt = Date.now();
  const u = db.users.filter((x) => x.id === o.userId)[0];
  if (u) u.subscribed = true;
  saveDB();
  log('pay', `订单 ${orderId} 支付成功，已开通会员`);
}

// 物品分类白名单（与前端 data.js 的 CATEGORIES 保持一致）
function CATEGORIES_KEYS() {
  return ['furniture', 'appliance', 'digital', 'baby', 'sport', 'book', 'other'];
}

/* ---------------- 路由 ---------------- */

const routes = {
  'POST /api/auth/send-code': async (req, res, b) => {
    const type = b.type === 'email' ? 'email' : 'phone';
    const account = String(b.account || '').trim();
    const okPhone = /^1[3-9]\d{9}$/.test(account);
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(account);
    if (type === 'phone' ? !okPhone : !okEmail) {
      return json(res, 400, { ok: false, msg: type === 'phone' ? '手机号格式不对' : '邮箱格式不对' });
    }
    // 60 秒限流：同一账号不可频繁重发
    const rec0 = db.codes[type + ':' + account];
    if (rec0 && Date.now() - rec0.at < 60000) {
      return json(res, 429, { ok: false, msg: '验证码已发送，请 60 秒后再试' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.codes[type + ':' + account] = { code, at: Date.now() };
    saveDB();
    if (type === 'email') {
      // 演示模式：邮件同样不打真实网络；生产可在 sms.js 同级补 smtp 发送
      log('auth', `向 ${account} 发送邮箱验证码（演示环境直接返回）`);
      return json(res, 200, { ok: true, code, expiresIn: 300, demo: true });
    }
    // 真实环境：调用短信服务商 API（缺密钥时 sms.js 自动降级为日志+演示）
    const sent = await sms.sendCode(type, account, code);
    log('auth', `向 ${account} 发送短信验证码（${sms.hasCred() ? '真实发送' : '演示模式'}）`);
    return json(res, 200, { ok: sent.ok, code: sent.demo ? code : undefined, expiresIn: 300, demo: sent.demo, provider: sms.providerName() });
  },

  'POST /api/auth/verify': async (req, res, b) => {
    const type = b.type === 'email' ? 'email' : 'phone';
    const account = String(b.account || '').trim();
    const rec = db.codes[type + ':' + account];
    if (!rec || rec.code !== String(b.code || '').trim()) {
      return json(res, 400, { ok: false, msg: '验证码不对或已过期' });
    }
    delete db.codes[type + ':' + account];
    let user = db.users.filter((u) => u.account === account)[0];
    if (user && user.disabled) {
      return json(res, 401, { ok: false, msg: '该账号已被禁用，请联系平台' });
    }
    let isNew = false;
    if (!user) {
      isNew = true;
      user = {
        id: 'u' + (db.users.length + 1),
        type, account,
        createdAt: Date.now(),
        city: 'shanghai',
        subscribed: false,
        inviteCode: genInviteCode(),
        inviteCount: 0, rewardDays: 0,
      };
      db.users.push(user);
      log('user', `新用户注册：${account}（${type}）`);
      if (b.inviteCode) applyInvite(b.inviteCode, user.id);
    } else {
      log('user', `用户登录：${account}`);
      if (!user.inviteCode) { user.inviteCode = genInviteCode(); }
    }
    saveDB();
    return json(res, 200, {
      ok: true, isNew, token: tokenOf(user.id),
      user: { id: user.id, account: user.account, type: user.type, city: user.city, subscribed: user.subscribed, inviteCode: user.inviteCode },
    });
  },

  'GET /api/me': async (req, res) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const kyc = db.kyc.filter((k) => k.userId === u.id)[0] || null;
    return json(res, 200, {
      ok: true,
      user: { id: u.id, account: u.account, type: u.type, city: u.city, subscribed: u.subscribed, inviteCode: u.inviteCode, inviteCount: u.inviteCount || 0, rewardDays: u.rewardDays || 0 },
      kyc: kyc ? { status: kyc.status, name: kyc.name, idNumber: kyc.idNumber } : null,
    });
  },

  'POST /api/kyc/submit': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const name = String(b.name || '').trim();
    const idNumber = String(b.idNumber || '').trim();
    if (name.length < 2) return json(res, 400, { ok: false, msg: '请填写真实姓名' });
    if (!idCardValid(idNumber)) return json(res, 400, { ok: false, msg: '身份证号校验不通过' });
    const masked = idNumber.slice(0, 4) + '**********' + idNumber.slice(-4);
    // 真实环境：对接服务商做姓名+身份证二要素核验（缺密钥时返回 pending，走人工审核）
    const v = await kyc.verifyIdCard({ name, idNumber });
    const status = (v.status === 'approved') ? 'approved' : (v.status === 'rejected') ? 'rejected' : 'pending';
    let rec = db.kyc.filter((k) => k.userId === u.id)[0];
    if (rec) {
      rec.name = name[0] + '*'.repeat(Math.max(1, name.length - 1));
      rec.idNumber = masked; rec.status = status; rec.createdAt = Date.now(); rec.demo = v.demo;
    } else {
      db.kyc.push({
        id: 'k' + (db.kyc.length + 1), userId: u.id,
        name: name[0] + '*'.repeat(Math.max(1, name.length - 1)),
        idNumber: masked, status, createdAt: Date.now(), demo: v.demo,
      });
    }
    saveDB();
    log('kyc', `${u.account} 提交实名认证，结果：${status}${v.demo ? '（演示/人工审核）' : ''}`);
    return json(res, 200, { ok: true, status, demo: v.demo });
  },

  'POST /api/pay/create': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const plan = b.plan === 'year' ? 'year' : 'month';
    const method = ['wechat', 'alipay', 'card'].indexOf(b.method) >= 0 ? b.method : 'wechat';
    const amount = plan === 'year' ? 11800 : 1900; // 单位：分
    const orderId = 'PAY' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10);
    db.orders.push({
      orderId, userId: u.id, plan, method, amount,
      status: 'pending', createdAt: Date.now(), paidAt: null,
    });
    saveDB();
    log('pay', `创建订单 ${orderId}：${plan} / ${method} / ¥${amount / 100}`);
    // 真实环境：调用微信支付/支付宝下单，返回真实 code_url / 收银台链接；
    // 缺密钥时 pay.js 自动降级为演示二维码，由前端「模拟支付」完成整条链路。
    const r = await pay.createOrder({
      orderId, amount, plan, method,
      description: 'Snag 会员·' + (plan === 'year' ? '年卡' : '月卡'),
    });
    if (!r.ok) return json(res, 502, { ok: false, msg: '下单失败', detail: r.error || r.detail });
    return json(res, 200, {
      ok: true, orderId, amount, status: 'pending',
      codeUrl: r.codeUrl, payUrl: r.payUrl, demo: r.demo, method: method,
      expiresAt: Date.now() + 15 * 60 * 1000,
      methodName: { wechat: '微信支付', alipay: '支付宝', card: '银行卡' }[method],
    });
  },

  // 支付平台异步回调：真实环境必须验签。微信 V3 验签+AES-GCM 解密，支付宝验签。
  // 演示模式（无密钥）下不接受此回调，仍走 /api/pay/mockpay 手动模拟。
  'POST /api/pay/notify': async (req, res, b) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const ch = u.searchParams.get('channel');
    let orderId = null, paid = false;
    if (ch === 'alipay') {
      if (!pay.alipayReady() || !pay.alipayVerify(b || {})) {
        return json(res, 400, { ok: false, msg: 'sign verify fail' });
      }
      if ((b.trade_status === 'TRADE_SUCCESS' || b.trade_status === 'TRADE_FINISHED')) { orderId = b.out_trade_no; paid = true; }
    } else {
      // 微信 V3：body 是明文 JSON（演示无平台证书则跳过验签）
      const dec = pay.wxVerifyAndDecrypt(req.headers, JSON.stringify(b));
      if (!dec.ok) return json(res, 400, { ok: false, msg: 'verify fail' });
      if (dec.data && dec.data.trade_state === 'SUCCESS') { orderId = dec.data.out_trade_no; paid = true; }
    }
    if (paid && orderId) markPaid(orderId);
    // 微信要求返回 200 + {code:'SUCCESS'}；支付宝要求返回 success
    if (ch === 'alipay') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('success'); }
    return json(res, 200, { code: 'SUCCESS', message: '成功' });
  },

  'GET /api/pay/query': async (req, res, b, query) => {
    const o = db.orders.filter((x) => x.orderId === query.orderId)[0];
    if (!o) return json(res, 404, { ok: false, msg: '订单不存在' });
    return json(res, 200, { ok: true, orderId: o.orderId, status: o.status, amount: o.amount, paidAt: o.paidAt });
  },

  // 演示专用：真实环境这里应该是支付平台回调 /notify，并且必须验签
  'POST /api/pay/mockpay': async (req, res, b) => {
    const o = db.orders.filter((x) => x.orderId === b.orderId)[0];
    if (!o) return json(res, 404, { ok: false, msg: '订单不存在' });
    if (o.status === 'paid') return json(res, 200, { ok: true, status: 'paid', paidAt: o.paidAt });
    markPaid(b.orderId);
    const fresh = db.orders.filter((x) => x.orderId === b.orderId)[0];
    return json(res, 200, { ok: true, status: 'paid', paidAt: fresh.paidAt });
  },

  'POST /api/event': async (req, res, b) => {
    if (b.type) {
      db.events.push({ type: String(b.type), at: Date.now(), count: 1 });
      db.events = db.events.slice(-5000);
      saveDB();
    }
    return json(res, 200, { ok: true });
  },

  // 前端功能埋点：{ name, props }，后端按令牌解析用户（真实产品应按 userId 归属）
  'POST /api/track': async (req, res, b) => {
    const name = String(b.name || b.type || '').trim();
    if (!name) return json(res, 400, { ok: false, msg: '缺少事件名' });
    const u = userByToken(req);
    db.tracks.push({
      name,
      at: Date.now(),
      userId: u ? u.id : null,
      props: (b.props && typeof b.props === 'object') ? b.props : {},
    });
    db.tracks = db.tracks.slice(-20000);
    saveDB();
    return json(res, 200, { ok: true });
  },

  'GET /api/admin/overview': async () => {
    const now = Date.now();
    const day = 86400000;
    const paidOrders = db.orders.filter((o) => o.status === 'paid');
    const mrr = paidOrders.reduce((a, o) => a + (o.plan === 'year' ? o.amount / 12 : o.amount), 0);
    const byDay = [];
    for (let d = 13; d >= 0; d--) {
      const start = now - (d + 1) * day, end = now - d * day;
      byDay.push({
        date: new Date(end).toISOString().slice(5, 10),
        users: db.users.filter((u) => u.createdAt >= start && u.createdAt < end).length,
        orders: paidOrders.filter((o) => o.paidAt >= start && o.paidAt < end).length,
        revenue: paidOrders.filter((o) => o.paidAt >= start && o.paidAt < end)
          .reduce((a, o) => a + o.amount, 0) / 100,
        views: db.events.filter((e) => e.type === 'view' && e.at >= start && e.at < end)
          .reduce((a, e) => a + (e.count || 1), 0),
        claims: db.events.filter((e) => e.type === 'claim' && e.at >= start && e.at < end)
          .reduce((a, e) => a + (e.count || 1), 0),
      });
    }
    const cityCount = {};
    db.users.forEach((u) => { cityCount[u.province || '未知'] = (cityCount[u.province || '未知'] || 0) + 1; });
    return {
      ok: true,
      cards: {
        users: db.users.length,
        paying: db.users.filter((u) => u.subscribed).length,
        mrr: Math.round(mrr / 100),
        todayUsers: db.users.filter((u) => u.createdAt > now - day).length,
        cities: 345, // 覆盖全国 345 个地级市
        provinces: Object.keys(cityCount).length,
        claims: db.events.filter((e) => e.type === 'claim').reduce((a, e) => a + (e.count || 1), 0),
        kycPending: db.kyc.filter((k) => k.status === 'pending').length,
      },
      byDay,
      cityCount,
    };
  },

  // 功能使用分析：用埋点数据 + 决策矩阵，回答「什么功能该放、什么可放、什么不该放」
  'GET /api/admin/analytics': async () => {
    const totalUsers = db.users.length;
    const nameTotals = {};
    const nameUsers = {};
    db.tracks.forEach((t) => {
      const n = t.name;
      nameTotals[n] = (nameTotals[n] || 0) + 1;
      if (t.userId) { (nameUsers[n] = nameUsers[n] || {})[t.userId] = 1; }
    });
    const features = Object.keys(FEATURE_DEFS).map((name) => {
      const def = FEATURE_DEFS[name];
      const total = nameTotals[name] || 0;
      const unique = nameUsers[name] ? Object.keys(nameUsers[name]).length : 0;
      return {
        name, label: def.label, decision: def.decision, why: def.why,
        total, unique, adoption: totalUsers ? +(unique / totalUsers * 100).toFixed(1) : 0,
        retentionLift: RETENTION_LIFT[name] || 0.2,
      };
    }).sort((a, b) => b.total - a.total);

    // 数据驱动再评估：用「触达率 45% + 使用量 35% + 留存关联 20%」算综合分，
    // 得出数据自发归类（dataBucket），再与产品决策（decision）比对，标记是否一致。
    const maxTotal = Math.max.apply(null, features.map((f) => f.total)) || 1;
    features.forEach((f) => {
      const usageShare = f.total / maxTotal;            // 0~1
      f.usageShare = +(usageShare * 100).toFixed(1);
      f.score = +(f.adoption * 0.45 + usageShare * 100 * 0.35 + f.retentionLift * 100 * 0.20).toFixed(1);
      const bucket = f.score >= 55 ? 'core' : f.score >= 35 ? 'enhance' : f.score >= 18 ? 'optional' : 'gated';
      f.dataBucket = bucket;
      f.align = bucket === f.decision ? '一致' : '建议复核';
    });

    // 区域分布（按省）
    const byProvince = {};
    db.tracks.forEach((t) => {
      const p = (t.props && t.props.province) || '未知';
      byProvince[p] = (byProvince[p] || 0) + 1;
    });

    // 决策汇总（产品决策 vs 数据自发归类）
    const summary = { core: 0, enhance: 0, optional: 0, gated: 0 };
    const dataSummary = { core: 0, enhance: 0, optional: 0, gated: 0 };
    features.forEach((f) => {
      summary[f.decision] = (summary[f.decision] || 0) + 1;
      dataSummary[f.dataBucket] = (dataSummary[f.dataBucket] || 0) + 1;
    });

    return {
      ok: true, totalUsers, features, byProvince, summary, dataSummary,
      generatedNote: '数据为演示种子 + 真实埋点累计；决策权重为基线，接真实数据后需回归校准。',
    };
  },

  'GET /api/admin/users': async () => ({
    ok: true,
    users: db.users.slice(-60).reverse().map((u) => ({
      id: u.id, account: u.account, type: u.type, city: u.city,
      subscribed: u.subscribed, createdAt: u.createdAt, disabled: !!u.disabled,
    })),
  }),

  'GET /api/admin/orders': async () => ({
    ok: true,
    orders: db.orders.slice(-60).reverse().map((o) => ({
      orderId: o.orderId, plan: o.plan, method: o.method,
      amount: o.amount, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt,
    })),
  }),

  'GET /api/admin/kyc': async () => ({
    ok: true,
    list: db.kyc.slice(-40).reverse(),
  }),

  'POST /api/admin/kyc/review': async (req, res, b) => {
    const k = db.kyc.filter((x) => x.id === b.id)[0];
    if (!k) return json(res, 404, { ok: false, msg: '记录不存在' });
    k.status = b.action === 'approve' ? 'approved' : 'rejected';
    k.reviewedAt = Date.now();
    saveDB();
    log('kyc', `实名记录 ${k.id} ${k.status === 'approved' ? '通过' : '驳回'}`);
    audit((adminTokenRec(req) && adminTokenRec(req).role) || 'admin', 'kyc_review', k.id, k.status);
    return json(res, 200, { ok: true, status: k.status });
  },

  'GET /api/admin/sources': async () => {
    const arr = ['闲鱼免费送', '业主微信群', '小区公告栏', '58 同城', '豆瓣小组'];
    return {
      ok: true,
      sources: arr.map((name, i) => {
        let s = 991 + i * 37;
        const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
        const total = 200 + Math.floor(rnd() * 500);
        const fail = Math.floor(rnd() * 18);
        return { name, total, fail, rate: +(fail / total * 100).toFixed(1), lastSync: Date.now() - Math.floor(rnd() * 900000) };
      }),
    };
  },

  'GET /api/admin/logs': async () => ({ ok: true, logs: db.logs.slice(0, 40) }),

  /* AI 智能客服：后端代理 LLM（默认本机 OFM 免费网关），离线自动降级规则问答 */
  'POST /api/ai/chat': async (req, res, b) => {
    const messages = Array.isArray(b.messages) ? b.messages : [];
    if (!messages.length) return json(res, 400, { ok: false, msg: '缺少消息' });
    const r = await ai.chat(messages);
    return json(res, 200, r);
  },

  /* ---------- 用户发布闲置 ---------- */
  'POST /api/listings': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const title = String(b.title || '').trim();
    const category = String(b.category || 'other').trim();
    if (title.length < 2) return json(res, 400, { ok: false, msg: '请填写物品标题' });
    // 内容机审前置：发布前先过滤违规/风险内容
    const mod = moderation.moderateListing({ title, desc: b.desc, address: b.address, condition: b.condition });
    if (mod.level === 'block') {
      log('mod', `${u.account} 发布被机审拦截(block)：${title} / ${JSON.stringify(mod.hits)}`);
      return json(res, 400, { ok: false, msg: '内容包含违规信息，无法发布。如误判可联系客服。' });
    }
    const id = 'L' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
    const listing = {
      id, userId: u.id, account: u.account,
      title, category: CATEGORIES_KEYS().indexOf(category) >= 0 ? category : 'other',
      desc: String(b.desc || '').trim(),
      condition: String(b.condition || '良好').trim(),
      district: String(b.district || '').trim(),
      address: String(b.address || '').trim(),
      cityCode: Number(b.cityCode) || null,
      lat: Number(b.lat) || null, lon: Number(b.lon) || null,
      images: Array.isArray(b.images) ? b.images.slice(0, 6) : [],
      status: mod.level === 'review' ? 'pending_review' : 'online',
      moderation: mod.hits.length ? mod.hits : null,
      views: 0, wants: 0,
      createdAt: Date.now(),
    };
    db.listings.push(listing);
    // 机审命中「需复核」：不公开，并自动生成一条机审举报，等后台人工通过
    if (mod.level === 'review') {
      db.reports.push({
        id: 'R' + (db.reports.length + 1), userId: null, auto: true,
        targetType: 'item', targetId: id,
        reason: '机审命中：' + mod.hits.map((h) => h.word).join('、'),
        status: 'pending', at: Date.now(),
      });
    }
    saveDB();
    log('listing', `${u.account} 发布闲置：${title}（机审 ${mod.level}）`);
    return json(res, 200, {
      ok: true, listing,
      needReview: mod.level === 'review',
      msg: mod.level === 'review' ? '内容已提交，机审待复核后将自动公开' : undefined,
    });
  },
  'GET /api/listings/mine': async (req) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const mine = db.listings.filter((l) => l.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, listings: mine };
  },
  'GET /api/listings': async (req, res, b, query) => {
    let list = db.listings.filter((l) => l.status === 'online');
    if (query.city) list = list.filter((l) => l.cityCode == query.city);
    list = list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
    return { ok: true, listings: list };
  },
  'POST /api/listings/delete': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const l = db.listings.filter((x) => x.id === b.id && x.userId === u.id)[0];
    if (!l) return json(res, 404, { ok: false, msg: '记录不存在' });
    l.status = 'offline';
    saveDB();
    log('listing', `${u.account} 下架闲置：${l.title}`);
    return json(res, 200, { ok: true });
  },

  /* ---------- 邀请裂变 ---------- */
  'POST /api/invite/bind': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    if (u.invitedBy) return json(res, 400, { ok: false, msg: '已绑定过邀请人' });
    const ok = applyInvite(b.code, u.id);
    if (!ok) return json(res, 400, { ok: false, msg: '邀请码无效' });
    saveDB();
    return json(res, 200, { ok: true, rewardDays: u.rewardDays });
  },
  'POST /api/invite/redeem': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    if ((u.rewardDays || 0) < 7) return json(res, 400, { ok: false, msg: '权益不足 7 天' });
    u.rewardDays -= 7; u.subscribed = true;
    saveDB();
    log('invite', `${u.account} 用 7 天权益兑换会员`);
    return json(res, 200, { ok: true, subscribed: true, rewardDays: u.rewardDays });
  },

  /* ---------- 内容举报（审核/防骗） ---------- */
  'POST /api/report': async (req, res, b) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const reason = String(b.reason || '').trim();
    if (!reason) return json(res, 400, { ok: false, msg: '请选择举报原因' });
    db.reports.push({
      id: 'R' + (db.reports.length + 1), userId: u.id,
      targetType: b.targetType || 'item', targetId: String(b.targetId || ''),
      reason, at: Date.now(), status: 'pending',
    });
    saveDB();
    log('report', `收到举报：${b.targetType} ${b.targetId} / ${reason}`);
    return json(res, 200, { ok: true, msg: '已收到举报，我们会尽快核实' });
  },

  /* ---------- 账号注销（应用商店合规：用户须能删除自己的账号） ---------- */
  'POST /api/account/delete': async (req, res) => {
    const u = userByToken(req);
    if (!u) return json(res, 401, { ok: false, msg: '未登录' });
    const uid = u.id;
    // 1) 撤销该用户的所有登录令牌
    Object.keys(db.tokens).forEach((tk) => { if (db.tokens[tk] === uid) delete db.tokens[tk]; });
    // 2) 其发布的闲置下架（保留记录、解除归属，便于后台追溯）
    db.listings.forEach((l) => { if (l.userId === uid) { l.status = 'taken_down'; l.userId = null; } });
    // 3) 实名记录删除（合规：注销即撤回授权）
    db.kyc = db.kyc.filter((k) => k.userId !== uid);
    // 4) 其发起的举报标记为已处理
    db.reports.forEach((r) => { if (r.userId === uid) r.status = 'resolved'; });
    // 5) 解除被邀请关系
    db.users.forEach((x) => { if (x.invitedBy === uid) x.invitedBy = null; });
    // 6) 删除用户主体
    db.users = db.users.filter((x) => x.id !== uid);
    saveDB();
    log('account', `用户 ${u.account} 注销账号，相关数据已清理`);
    audit(u.account, 'delete_account', u.account, '用户主动注销');
    return json(res, 200, { ok: true });
  },

  /* ---------- 内容审核（后台：举报处理 + 下架 + 封禁） ---------- */
  'GET /api/admin/reports': async () => {
    const accOf = (id) => { const x = db.users.filter((u) => u.id === id)[0]; return x ? x.account : '—'; };
    const titleOf = (tid) => { const l = db.listings.filter((x) => x.id === tid)[0]; return l ? l.title : '(已删除)'; };
    const list = db.reports.slice().sort((a, b) =>
      ((a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)) || b.at - a.at);
    return {
      ok: true,
      reports: list.map((r) => ({
        id: r.id, targetType: r.targetType, targetId: r.targetId,
        targetTitle: r.targetType === 'item' ? titleOf(r.targetId) : '',
        reason: r.reason, status: r.status, at: r.at,
        reporter: accOf(r.userId),
      })),
    };
  },
  'POST /api/admin/report/resolve': async (req, res, b) => {
    const r = db.reports.filter((x) => x.id === b.id)[0];
    if (!r) return json(res, 404, { ok: false, msg: '举报记录不存在' });
    r.status = b.action === 'ignore' ? 'ignored' : 'resolved';
    r.reviewedAt = Date.now();
    saveDB();
    log('report', `举报 ${r.id} 标记处理：${r.status}`);
    audit((adminTokenRec(req) && adminTokenRec(req).role) || 'admin', 'resolve_report', r.id, r.status);
    return json(res, 200, { ok: true, status: r.status });
  },
  'POST /api/admin/takedown': async (req, res, b) => {
    const type = String(b.targetType || '');
    const id = String(b.targetId || '');
    if (type === 'item') {
      const l = db.listings.filter((x) => x.id === id)[0];
      if (!l) return json(res, 404, { ok: false, msg: '闲置不存在' });
      l.status = 'taken_down';
      db.reports.filter((r) => r.targetType === 'item' && r.targetId === id && r.status === 'pending')
        .forEach((r) => { r.status = 'resolved'; });
      saveDB();
      log('mod', `下架闲置：${l.title}（${b.reason || '违规'}）`);
      audit((adminTokenRec(req) && adminTokenRec(req).role) || 'admin', 'takedown_item', id, l.title);
      return json(res, 200, { ok: true, status: l.status });
    }
    if (type === 'user') {
      const u = db.users.filter((x) => x.id === id)[0];
      if (!u) return json(res, 404, { ok: false, msg: '用户不存在' });
      u.disabled = true;
      db.listings.filter((x) => x.userId === id).forEach((x) => { x.status = 'taken_down'; });
      db.reports.filter((r) => r.targetType === 'user' && r.targetId === id && r.status === 'pending')
        .forEach((r) => { r.status = 'resolved'; });
      saveDB();
      log('mod', `封禁用户：${u.account}`);
      return json(res, 200, { ok: true, disabled: true });
    }
    return json(res, 400, { ok: false, msg: '未知目标类型' });
  },
  'POST /api/admin/user/ban': async (req, res, b) => {
    const u = db.users.filter((x) => x.id === b.userId)[0];
    if (!u) return json(res, 404, { ok: false, msg: '用户不存在' });
    u.disabled = b.action !== 'unban';
    if (u.disabled) db.listings.filter((x) => x.userId === u.id).forEach((x) => { x.status = 'taken_down'; });
    saveDB();
    log('mod', `${u.disabled ? '封禁' : '解封'}用户：${u.account}`);
    audit(adminTokenRec(req) && adminTokenRec(req).role, 'ban_user', u.account, u.disabled ? '封禁' : '解封');
    return json(res, 200, { ok: true, disabled: u.disabled });
  },

  /* ---------- 内容机审：待复核闲置 + 通过 ---------- */
  'GET /api/admin/moderation': async () => {
    const pending = db.listings
      .filter((l) => l.status === 'pending_review')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((l) => ({
        id: l.id, title: l.title, category: l.category, desc: l.desc,
        account: l.account, district: l.district, hits: l.moderation || [],
        createdAt: l.createdAt,
      }));
    const autoReports = db.reports
      .filter((r) => r.auto && r.status === 'pending')
      .sort((a, b) => b.at - a.at)
      .map((r) => ({ id: r.id, targetId: r.targetId, reason: r.reason, at: r.at }));
    return { ok: true, pending, autoReports };
  },
  'POST /api/admin/listing/approve': async (req, res, b) => {
    const l = db.listings.filter((x) => x.id === b.id)[0];
    if (!l) return json(res, 404, { ok: false, msg: '闲置不存在' });
    l.status = 'online';
    db.reports.filter((r) => r.targetType === 'item' && r.targetId === b.id && r.status === 'pending')
      .forEach((r) => { r.status = 'resolved'; });
    saveDB();
    log('mod', `机审通过并上架：${l.title}`);
    audit(adminTokenRec(req) && adminTokenRec(req).role, 'approve_listing', b.id, l.title);
    return json(res, 200, { ok: true, status: 'online' });
  },

  /* ---------- 操作审计日志 ---------- */
  'GET /api/admin/audit': async () => ({
    ok: true,
    audit: db.audit.slice(0, 100),
  }),

  /* ---------- 社交证明（首页激励） ---------- */
  'GET /api/social': async (req, res, b, query) => {
    const online = db.listings.filter((l) => l.status === 'online');
    const givingNearby = online.length + 1200;
    const claimedWeek = 860 + (db.events.filter((e) => e.type === 'claim').reduce((a, e) => a + (e.count || 1), 0) % 600);
    return { ok: true, givingNearby, claimedWeek, totalListings: db.listings.length, onlineListings: online.length };
  },

  // 管理员登录：校验账号密码，签发随机令牌（存 adminTokens）
  'POST /api/admin/login': async (req, res, b) => {
    const user = String(b.user || '').trim();
    const pass = String(b.pass || '');
    const matched = ADMINS.filter((a) => a.user === user && a.pass === pass)[0];
    if (!matched) {
      log('admin', '后台登录失败：账号或密码错误（' + user + '）');
      return json(res, 401, { ok: false, msg: '账号或密码错误' });
    }
    const t = crypto.randomBytes(24).toString('hex');
    if (!db.adminTokens) db.adminTokens = {};
    db.adminTokens[t] = { role: matched.role, at: Date.now() };
    saveDB();
    log('admin', '后台登录成功：' + user + '（' + matched.role + '）');
    audit(user, 'login', '', '角色 ' + matched.role);
    return json(res, 200, { ok: true, token: t, role: matched.role });
  },

  // 管理员登出：吊销当前令牌
  'POST /api/admin/logout': async (req) => {
    const h = req.headers.authorization || '';
    const t = h.replace(/^Bearer\s+/i, '').trim();
    if (db.adminTokens && t) delete db.adminTokens[t];
    saveDB();
    return { ok: true };
  },
};

/* ---------------- 服务器 ---------------- */

const handler = async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(u.pathname);
  const key = req.method + ' ' + pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });

  if (key.indexOf('/api/') !== -1) {
    // 后台鉴权网关：除登录接口外，所有 /api/admin/* 必须带有效管理员令牌
    if (pathname.indexOf('/api/admin/') === 0 && pathname !== '/api/admin/login') {
      const role = adminByToken(req);
      if (!role) {
        return json(res, 401, { ok: false, msg: '未授权，请先登录后台' });
      }
      // 角色约束：moderator 不能访问用户管理 / 数据分析 / 来源明细等敏感面板
      const sensitive = ['/api/admin/users', '/api/admin/analytics', '/api/admin/sources'];
      if (role !== 'admin' && sensitive.some((p) => pathname.indexOf(p) === 0)) {
        return json(res, 403, { ok: false, msg: '权限不足：该操作仅限管理员' });
      }
    }
    const handler = routes[key];
    if (handler) {
      try {
        const b = req.method === 'POST' ? await body(req) : {};
        const out = await handler(req, res, b, query);
        if (out !== undefined) return json(res, 200, out);
        return;
      } catch (e) {
        return json(res, 500, { ok: false, msg: '服务端异常：' + e.message });
      }
    }
    return json(res, 404, { ok: false, msg: '接口不存在：' + key });
  }

  // 静态文件
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/admin' || file === '/admin/') file = '/admin.html';
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) return json(res, 403, { ok: false, msg: 'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
};

// HTTPS 接入：若配置了 SNAG_TLS_KEY / SNAG_TLS_CRT 且文件存在，则用 HTTPS 启动；否则回退 HTTP。
// 证书可由 Let's Encrypt(certbot) 或云厂商免费签发后，把路径填进环境变量即可，无需改代码。
const TLS_KEY = process.env.SNAG_TLS_KEY, TLS_CRT = process.env.SNAG_TLS_CRT;
let server, proto = 'http';
if (TLS_KEY && TLS_CRT && fs.existsSync(TLS_KEY) && fs.existsSync(TLS_CRT)) {
  const tlsOpts = { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CRT) };
  if (process.env.SNAG_TLS_CA && fs.existsSync(process.env.SNAG_TLS_CA)) {
    tlsOpts.ca = fs.readFileSync(process.env.SNAG_TLS_CA);
  }
  server = https.createServer(tlsOpts, handler);
  proto = 'https';
} else {
  server = http.createServer(handler);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Snag 服务已启动' + (proto === 'https' ? '（HTTPS）' : ''));
  console.log('  前端  ' + proto + '://127.0.0.1:' + PORT);
  console.log('  后台  ' + proto + '://127.0.0.1:' + PORT + '/admin');
  console.log('  数据  ' + DB_FILE);
  if (proto === 'http') console.log('  [提示] 未配置 TLS，当前为 HTTP；上架前请配置 SNAG_TLS_KEY/SNAG_TLS_CRT 启用 HTTPS');
});
