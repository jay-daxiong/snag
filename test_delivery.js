// 交付标准：短信/支付/实名 在演示模式下的链路测试（无真实密钥）
const http = require('http');
function req(method, path, body, token) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: process.env.TESTPORT || 8799, path, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}) },
      (x) => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ code: x.statusCode, body: JSON.parse(d) }); } catch (e) { res({ code: x.statusCode, body: d }); } }); });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra || ''); } }

(async () => {
  // 注册拿 token
  let s = await req('POST', '/api/auth/send-code', { type: 'phone', account: '13800000000' });
  check('send-code 演示返回 code+demo', s.body.ok && s.body.demo && /^\d{6}$/.test(s.body.code), s.body);
  let v = await req('POST', '/api/auth/verify', { type: 'phone', account: '13800000000', code: s.body.code });
  check('verify 登录拿到 token', v.body.ok && v.body.token, v.body);
  const token = v.body.token;

  // 实名：演示模式应返回 pending + demo
  let k = await req('POST', '/api/kyc/submit', { name: '张三', idNumber: '110101199003071233' }, token);
  check('kyc 演示返回 pending+demo', k.body.ok && k.body.status === 'pending' && k.body.demo, k.body);

  // 支付：演示模式返回 code_url + demo
  let p = await req('POST', '/api/pay/create', { plan: 'month', method: 'wechat' }, token);
  check('pay create 演示返回 codeUrl+demo', p.body.ok && p.body.codeUrl && p.body.demo, p.body);
  let m = await req('POST', '/api/pay/mockpay', { orderId: p.body.orderId });
  check('pay mockpay 标记 paid', m.body.ok && m.body.status === 'paid', m.body);
  let q = await req('GET', '/api/pay/query?orderId=' + p.body.orderId);
  check('pay query 状态 paid', q.body.ok && q.body.status === 'paid', q.body);

  // notify 无密钥应拒绝（演示模式不接受真实回调）
  let n = await req('POST', '/api/pay/notify?channel=alipay', { out_trade_no: p.body.orderId, trade_status: 'TRADE_SUCCESS' });
  check('notify 无密钥被拒', n.code === 400, n);

  console.log('\n交付链路测试: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
