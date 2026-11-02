/* 前端鉴权契约测试：用最小 DOM/fetch 垫片在 Node 里跑真实的 admin.js，
 * 验证「无 token→弹登录 / 登录成功→带 Bearer 拉数据 / 登出→吊销」整条链路。
 * 不依赖浏览器，避免沙箱里没有 Chrome 的限制。
 */
const http = require('http');

const PORT = process.env.TESTPORT || 8799;

// ---- fetch 垫片：直连本机 TCP，不经代理 ----
global.fetch = function (url, opts) {
  opts = opts || {};
  const u = new URL(url);
  const method = opts.method || 'GET';
  const body = opts.body || null;
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const req = http.request({
      host: u.hostname, port: u.port,
      path: u.pathname + (u.search || ''), method,
      headers: Object.assign({}, opts.headers || {}),
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { let j; try { j = JSON.parse(raw); } catch (e) { j = {}; } resolve({ status: res.statusCode, json: () => Promise.resolve(j) }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

// ---- DOM 垫片 ----
const els = {};
function makeEl() {
  return {
    hidden: undefined, value: '', textContent: '', className: '', innerHTML: '',
    _handlers: {},
    addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); },
    getAttribute() { return null; }, closest() { return null; },
  };
}
function getEl(key) { return els[key] || (els[key] = makeEl()); }
global.document = {
  querySelector: (s) => getEl(s),
  querySelectorAll: () => [],
  getElementById: (id) => getEl(id),
  createElement: () => ({ src: '', onload: null }),
  head: { appendChild() {} },
  addEventListener() {},
};
global.localStorage = (function () {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
})();
global.location = { protocol: 'http:', origin: 'http://127.0.0.1:' + PORT };
global.setInterval = () => 0;
global.window = global;

// 加载真实的 admin.js（IIFE 会立即执行，无 token 应弹登录）
require('./admin.js');

function fire(key, type, ev) {
  const el = getEl(key);
  (el._handlers[type] || []).forEach((fn) => fn(ev || {}));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let pass = 0, total = 0;
  const check = (n, c, x) => { total++; if (c) pass++; console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  ' + x : '')); };

  // 1) 初始无 token → 登录遮罩可见
  await sleep(50);
  check('初始无 token：登录遮罩显示', getEl('loginMask').hidden === false, 'hidden=' + getEl('loginMask').hidden);

  // 2) 模拟填写并登录
  getEl('loginUser').value = 'admin';
  getEl('loginPass').value = 'admin123';
  fire('loginForm', 'submit', { preventDefault() {} });
  await sleep(400);

  check('登录后：遮罩隐藏', getEl('loginMask').hidden === true, 'hidden=' + getEl('loginMask').hidden);
  check('登录后：连接状态为已连接', /已连接/.test(getEl('#conn').textContent), 'conn=' + getEl('#conn').textContent);
  check('登录后：登出按钮可见', getEl('logout').hidden === false, 'hidden=' + getEl('logout').hidden);
  check('登录后：令牌已写入 localStorage', !!global.localStorage.getItem('snag_admin_token'));

  // 3) 模拟登出
  fire('logout', 'click', {});
  await sleep(300);
  check('登出后：遮罩重新显示', getEl('loginMask').hidden === false);
  check('登出后：令牌已清除', !global.localStorage.getItem('snag_admin_token'));

  // 4) 错误密码登录应报错（不隐藏遮罩）
  getEl('loginMask').hidden = false; // 复位
  getEl('loginUser').value = 'admin';
  getEl('loginPass').value = 'wrongpass';
  fire('loginForm', 'submit', { preventDefault() {} });
  await sleep(300);
  check('错误密码：遮罩仍显示', getEl('loginMask').hidden === false);
  check('错误密码：显示错误提示', getEl('loginErr').hidden === false && /账号或密码/.test(getEl('loginErr').textContent), getEl('loginErr').textContent);

  console.log('\n前端鉴权契约: ' + pass + '/' + total + (pass === total ? '  ALL PASS' : '  HAVE FAIL'));
  process.exit(pass === total ? 0 : 1);
})();
