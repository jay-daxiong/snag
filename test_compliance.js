// 上架合规验证：隐私/协议静态页 + 举报审核下架 + 账号注销
const http = require('http');
function req(method, path, body, token) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.TESTPORT || 8799, path, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}) },
      (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ code: x.statusCode, body: JSON.parse(d) }); } catch (e) { res({ code: x.statusCode, body: d }); } }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x || ''); } }

(async () => {
  // 静态页
  for (const p of ['/privacy.html', '/agreement.html', '/manifest.json']) {
    const s = await req('GET', p);
    check('静态资源 ' + p, s.code === 200, s);
  }

  // 管理员登录
  const al = await req('POST', '/api/admin/login', { user: 'admin', pass: 'admin123' });
  check('管理员登录', al.body.ok && al.body.token, al.body);
  const at = al.body.token;

  // 建一个测试用户并发布闲置
  const u = (Date.now() % 1000000000).toString().padStart(9, '0');
  const PH = '138' + u.slice(0, 8);
  const s = await req('POST', '/api/auth/send-code', { type: 'phone', account: PH });
  const v = await req('POST', '/api/auth/verify', { type: 'phone', account: PH, code: s.body.code });
  check('用户注册', v.body.ok && v.body.token, v.body);
  const ut = v.body.token;
  const pub = await req('POST', '/api/listings', { title: '测试旧沙发', category: 'furniture', desc: '测试', condition: '良好', district: '浦东', cityCode: 310100, address: 'x' }, ut);
  check('发布闲置', pub.body.ok && pub.body.listing.id, pub.body);
  const lid = pub.body.listing.id;

  // 用户举报该闲置
  const rep = await req('POST', '/api/report', { targetType: 'item', targetId: lid, reason: '疑似违规' }, ut);
  check('提交举报', rep.body.ok, rep.body);

  // 后台看举报列表
  const reps = await req('GET', '/api/admin/reports', null, at);
  check('后台举报列表含该条', reps.body.ok && reps.body.reports.some(r => r.targetId === lid && r.status === 'pending'), reps.body);
  const rid = reps.body.reports.filter(r => r.targetId === lid)[0].id;

  // 后台下架该闲置
  const td = await req('POST', '/api/admin/takedown', { targetType: 'item', targetId: lid, reason: '违规下架' }, at);
  check('后台下架闲置', td.body.ok && td.body.status === 'taken_down', td.body);

  // 下架后公开列表不含
  const publist = await req('GET', '/api/listings');
  check('下架后公开列表不含', !publist.body.listings.some(l => l.id === lid), publist.body);

  // 举报被自动标记为已处理
  const reps2 = await req('GET', '/api/admin/reports', null, at);
  check('下架后举报转已处理', reps2.body.reports.some(r => r.id === rid && r.status === 'resolved'), reps2.body);

  // 标记处理（ignore）
  const rs = await req('POST', '/api/admin/report/resolve', { id: rid, action: 'ignore' }, at);
  check('标记举报处理', rs.body.ok, rs.body);

  // 账号注销
  const del = await req('POST', '/api/account/delete', {}, ut);
  check('账号注销成功', del.body.ok, del.body);

  // 注销后再用该 token 访问受保护接口应 401
  const after = await req('GET', '/api/me', null, ut);
  check('注销后 token 失效', after.code === 401, after);

  // 用已被注销的账号重新登录应失败（账号主体已删）
  const rl = await req('POST', '/api/auth/verify', { type: 'phone', account: PH, code: '000000' });
  // 注意：账号删除后重新登录会视为新注册，这里只验证旧 token 已失效即可（上面已验证）

  console.log('\n上架合规测试: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
