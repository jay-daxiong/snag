// 增长链路：发布闲置 + 邀请裂变 + 举报 + 社交证明
const http = require('http');
function req(method, path, body, token) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.TESTPORT || 8799, path, method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}) }, (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ code: x.statusCode, body: JSON.parse(d) }); } catch (e) { res({ code: x.statusCode, body: d }); } }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
let pass = 0, fail = 0;
function check(n, c, x) { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x || ''); } }

// 每次运行使用唯一手机号，避免复用 server-data.json 中已存在的账号导致 applyInvite 被跳过
const UNIQ = (Date.now() % 1000000000).toString().padStart(9, '0');
const PH1 = '138' + UNIQ.slice(0, 8);   // 138 + 8 位 = 11 位合法手机号
const PH2 = '139' + UNIQ.slice(0, 8);   // 139 + 8 位 = 11 位合法手机号

(async () => {
  // 邀请人注册
  let s1 = await req('POST', '/api/auth/send-code', { type: 'phone', account: PH1 });
  let v1 = await req('POST', '/api/auth/verify', { type: 'phone', account: PH1, code: s1.body.code });
  const t1 = v1.body.token, code = v1.body.user.inviteCode;
  check('邀请人含 inviteCode', !!code, v1.body);

  // 被邀请人用邀请码注册
  let s2 = await req('POST', '/api/auth/send-code', { type: 'phone', account: PH2 });
  let v2 = await req('POST', '/api/auth/verify', { type: 'phone', account: PH2, code: s2.body.code, inviteCode: code });
  const t2 = v2.body.token;
  check('被邀请人注册成功', v2.body.ok, v2.body);

  // 邀请人奖励应增加（重新拉 me）
  let m1 = await req('GET', '/api/me', null, t1);
  check('邀请人 rewardDays>=7', m1.body.user.rewardDays >= 7, m1.body.user);

  // 被邀请人发布闲置
  let p = await req('POST', '/api/listings', { title: '九成新婴儿床', category: 'baby', desc: '孩子大了用不上', condition: '良好', district: '浦东新区', cityCode: 310100, address: '世纪大道1号' }, t2);
  check('发布闲置成功', p.body.ok && p.body.listing.id, p.body);
  const lid = p.body.listing.id;

  // 我的闲置列表
  let mine = await req('GET', '/api/listings/mine', null, t2);
  check('我的闲置含刚发布的', mine.body.listings.length >= 1 && mine.body.listings[0].id === lid, mine.body);

  // 公开浏览
  let pub = await req('GET', '/api/listings');
  check('公开列表含该闲置', pub.body.listings.some(l => l.id === lid), pub.body);

  // 下架
  let del = await req('POST', '/api/listings/delete', { id: lid }, t2);
  check('下架成功', del.body.ok, del.body);
  let pub2 = await req('GET', '/api/listings');
  check('下架后不在公开列表', !pub2.body.listings.some(l => l.id === lid), pub2.body);

  // 举报
  let rep = await req('POST', '/api/report', { targetType: 'item', targetId: '3101-it1', reason: '疑似诈骗/要求押金' }, t2);
  check('举报成功', rep.body.ok, rep.body);

  // 社交证明
  let soc = await req('GET', '/api/social?city=310100');
  check('社交证明返回', soc.body.ok && soc.body.givingNearby > 0 && soc.body.claimedWeek > 0, soc.body);

  // 兑换会员
  let rd = await req('POST', '/api/invite/redeem', {}, t1);
  check('兑换会员成功', rd.body.ok && rd.body.subscribed === true, rd.body);

  console.log('\n增长链路测试: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
