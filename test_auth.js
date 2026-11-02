/* 鉴权流程测试：直接走本机 TCP，不依赖代理 */
const http = require('http');
const PORT = process.env.TESTPORT || 8799;
function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        data ? { 'Content-Length': Buffer.byteLength(data) } : {},
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json; try { json = JSON.parse(raw); } catch (e) { json = raw; }
        resolve({ code: res.statusCode, json });
      });
    });
    r.on('error', (e) => resolve({ code: 0, json: { err: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  let pass = 0, total = 0;
  function check(name, cond, extra) {
    total++; if (cond) pass++;
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''));
  }
  // 1) 未登录访问受保护接口 -> 401
  let r = await req('GET', '/api/admin/overview');
  check('未带 token 访问 /api/admin/overview 被拒', r.code === 401, 'code=' + r.code);

  // 2) 错误密码登录 -> 401
  r = await req('POST', '/api/admin/login', { user: 'admin', pass: 'wrong' });
  check('错误密码登录被拒', r.code === 401 && r.json.ok === false, 'code=' + r.code);

  // 3) 正确登录 -> 200 + token
  r = await req('POST', '/api/admin/login', { user: 'admin', pass: 'admin123' });
  check('正确账号密码登录成功', r.code === 200 && r.json.ok && !!r.json.token, 'code=' + r.code + ' token?' + !!r.json.token);
  const token = r.json.token;

  // 4) 带 token 访问受保护接口 -> 200
  r = await req('GET', '/api/admin/overview', null, token);
  check('带 token 访问受保护接口成功', r.code === 200 && r.json.ok, 'code=' + r.code);

  // 5) 带 token 访问 analytics -> 200
  r = await req('GET', '/api/admin/analytics', null, token);
  check('analytics 受保护可达', r.code === 200 && r.json.ok && Array.isArray(r.json.features), 'features=' + (r.json.features || []).length);

  // 6) 伪造/无效 token -> 401
  r = await req('GET', '/api/admin/overview', null, 'deadbeef');
  check('伪造 token 被拒', r.code === 401, 'code=' + r.code);

  // 7) 登出 -> 吊销 token，之后 401
  r = await req('POST', '/api/admin/logout', {}, token);
  check('登出成功', r.code === 200 && r.json.ok, 'code=' + r.code);
  r = await req('GET', '/api/admin/overview', null, token);
  check('登出后旧 token 失效', r.code === 401, 'code=' + r.code);

  // 8) 前端页面仍可访问（不校验）
  r = await req('GET', '/admin');
  check('后台页面本身可访问(未受 token 保护)', r.code === 200, 'code=' + r.code);

  console.log('\n鉴权测试: ' + pass + '/' + total + (pass === total ? '  ALL PASS' : '  HAVE FAIL'));
  process.exit(pass === total ? 0 : 1);
})();
