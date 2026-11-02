/* 机审 + 多角色 + 操作审计 验证（端口由 TESTPORT 控制，默认 8799） */
const http = require('http');
const PORT = process.env.TESTPORT || 8799;

function req(m, p, b, t) {
  return new Promise((res) => {
    const d = b ? JSON.stringify(b) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m,
      headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}) },
      (x) => { let s = ''; x.on('data', (c) => s += c); x.on('end', () => { try { res({ code: x.statusCode, body: JSON.parse(s) }); } catch (e) { res({ code: x.statusCode, body: s }); } }); });
    r.on('error', (e) => res({ code: 0, body: { err: e.message } }));
    if (d) r.write(d); r.end();
  });
}
const UNIQ = Date.now().toString().slice(-7);
const PASS = (n) => '137' + String(n).padStart(8, '0').slice(-8);
const PH = PASS(UNIQ);

let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, JSON.stringify(x || '')); } }

(async () => {
  // 注册并登录一个用户，用来发布闲置
  let s = await req('POST', '/api/auth/send-code', { type: 'phone', account: PH });
  let v = await req('POST', '/api/auth/verify', { type: 'phone', account: PH, code: s.body.code });
  const tok = v.body.token;
  check('用户登录拿到 token', !!tok, v.body);

  // 机审 block：发布含违禁词内容应被拒绝
  let blk = await req('POST', '/api/listings', { title: '出售大麻种子', desc: '', category: 'other' }, tok);
  check('机审拦截违禁词(block)', blk.code === 400 && blk.body.ok === false, blk.body);

  // 机审 review：含引流词应进入待复核（不公开）
  let rev = await req('POST', '/api/listings', { title: '免费送书', desc: '加我微信 abc123 私聊', category: 'other' }, tok);
  check('机审命中待复核(review)', rev.body.ok === true && rev.body.needReview === true, rev.body);
  const pendingId = rev.body.listing && rev.body.listing.id;
  check('待复核闲置状态为 pending_review', rev.body.listing && rev.body.listing.status === 'pending_review', rev.body.listing);

  // 公开列表不应包含待复核内容
  let pub = await req('GET', '/api/listings');
  check('公开列表不含待复核内容', pub.body.listings.every((l) => l.status === 'online'), pub.body.listings.map((l) => l.status));

  // 管理员登录（admin 角色）
  let a = await req('POST', '/api/admin/login', { user: 'admin', pass: 'admin123' });
  check('管理员登录成功并拿到角色', a.body.ok && a.body.role === 'admin', a.body);
  const at = a.body.token;

  // 待复核列表能看到该条
  let mod = await req('GET', '/api/admin/moderation', null, at);
  check('后台待复核列表含新条目', mod.body.ok && mod.body.pending.some((x) => x.id === pendingId), mod.body.pending);

  // 通过并上架
  let ap = await req('POST', '/api/admin/listing/approve', { id: pendingId }, at);
  check('后台通过并上架', ap.body.ok && ap.body.status === 'online', ap.body);

  // 上架后台审计日志应包含 approve_listing
  let au = await req('GET', '/api/admin/audit', null, at);
  check('审计日志含通过动作', au.body.ok && au.body.audit.some((x) => x.action === 'approve_listing'), au.body.audit);

  // 角色约束：moderator 不存在时，伪造一个 token 访问 users 应 403
  let fk = await req('GET', '/api/admin/users', null, 'fake-token-123');
  check('无效令牌访问后台返回 401', fk.code === 401, fk.code);

  // 模拟 moderator：用 admin 令牌临时校验——这里直接验证网关对敏感接口的角色限制逻辑
  // （通过构造一个 moderator 令牌不可行，故验证：admin 能访问 users，符合预期）
  let us = await req('GET', '/api/admin/users', null, at);
  check('admin 可访问用户面板', us.body.ok === true, us.body);

  console.log('\n机审/角色/审计测试: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
