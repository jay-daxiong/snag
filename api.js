/* Snag 前端 API 层
 *
 * 设计：优先走同源后端（页面由 server.js 托管时，BASE = location.origin，
 * 本地即 http://127.0.0.1:8787、云端即 https://你的域名，API 与页面同源，
 * 部署到任何主机都无需改配置）；
 * 如果是直接双击打开 index.html（file:// 协议），则回退到本地后端
 * http://127.0.0.1:8787。后端没启动时自动降级到本地模拟，保证界面始终可点通。
 */

var Api = (function () {
  'use strict';

  // 同源优先：页面由后端托管时直接用 location.origin（部署零配置）；
  // 仅当以 file:// 直接打开时才回退到本地开发服务器。
  var BASE = (typeof location !== 'undefined' && location.protocol !== 'file:' && location.host)
    ? location.origin
    : 'http://127.0.0.1:8787';
  var LS_TOKEN = 'snag.token';
  var LS_DB = 'snag.localdb';

  var online = null; // null=未知 true=后端可用 false=降级
  var token = null;
  try { token = localStorage.getItem(LS_TOKEN); } catch (e) { token = null; }

  function localDB() {
    try { return JSON.parse(localStorage.getItem(LS_DB)) || {}; }
    catch (e) { return {}; }
  }
  function saveLocal(d) { try { localStorage.setItem(LS_DB, JSON.stringify(d)); } catch (e) {} }

  function req(method, path, payload) {
    return fetch(BASE + path, {
      method: method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      body: payload ? JSON.stringify(payload) : undefined,
    }).then(function (r) { return r.json(); });
  }

  // 探测后端是否可用，只探测一次
  function probe() {
    if (online !== null) return Promise.resolve(online);
    return fetch(BASE + '/api/admin/logs', { method: 'GET' })
      .then(function () { online = true; return true; })
      .catch(function () { online = false; return false; });
  }

  function setToken(t) {
    token = t;
    try { t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN); } catch (e) {}
  }
  function getToken() { return token; }

  /* ---------- 验证码 ---------- */

  function sendCode(type, account) {
    return probe().then(function (ok) {
      if (ok) return req('POST', '/api/auth/send-code', { type: type, account: account });
      // 降级：本地生成，直接回给界面显示
      var code = String(Math.floor(100000 + Math.random() * 900000));
      var d = localDB();
      d.codes = d.codes || {};
      d.codes[type + ':' + account] = code;
      saveLocal(d);
      return { ok: true, code: code, expiresIn: 300, demo: true, offline: true };
    });
  }

  function verify(type, account, code, inviteCode) {
    return probe().then(function (ok) {
      var body = { type: type, account: account, code: code };
      if (inviteCode) body.inviteCode = inviteCode;
      if (ok) {
        return req('POST', '/api/auth/verify', body)
          .then(function (r) { if (r.ok) setToken(r.token); return r; });
      }
      var d = localDB();
      d.codes = d.codes || {};
      if (d.codes[type + ':' + account] !== String(code).trim()) {
        return { ok: false, msg: '验证码不对或已过期' };
      }
      delete d.codes[type + ':' + account];
      d.users = d.users || {};
      var isNew = !d.users[account];
      d.users[account] = { account: account, type: type, createdAt: Date.now(), subscribed: false };
      saveLocal(d);
      setToken('local.' + account);
      return {
        ok: true, isNew: isNew, token: 'local.' + account, offline: true,
        user: { id: 'local', account: account, type: type, subscribed: false },
      };
    });
  }

  function me() {
    if (!token) return Promise.resolve({ ok: false, msg: '未登录' });
    return probe().then(function (ok) {
      if (ok) return req('GET', '/api/me');
      var d = localDB();
      var acc = String(token).replace(/^local\./, '');
      var u = (d.users || {})[acc];
      return {
        ok: !!u, offline: true,
        user: u ? { id: 'local', account: acc, type: u.type, subscribed: u.subscribed } : null,
        kyc: u && u.kyc ? { status: u.kyc.status, name: u.kyc.name, idNumber: u.kyc.idNumber } : null,
      };
    });
  }

  function logout() { setToken(null); }

  /* ---------- 实名认证 ----------
   * 前端只做格式与校验位检查（GB 11643-1999 mod 11-2，真实算法）。
   * 真正的实名必须对接公安库或第三方认证服务，这里做不到。 */
  function idCardValid(no) {
    no = String(no || '').trim();
    if (!/^\d{17}[\dXx]$/.test(no)) return false;
    var w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    var codes = '10X98765432';
    var sum = 0;
    for (var i = 0; i < 17; i++) sum += parseInt(no[i], 10) * w[i];
    return codes[sum % 11] === no[17].toUpperCase();
  }

  function kycSubmit(name, idNumber) {
    return probe().then(function (ok) {
      if (ok) return req('POST', '/api/kyc/submit', { name: name, idNumber: idNumber });
      if (!idCardValid(idNumber)) return { ok: false, msg: '身份证号校验不通过' };
      var d = localDB();
      var acc = String(token).replace(/^local\./, '');
      d.users = d.users || {};
      if (!d.users[acc]) return { ok: false, msg: '未登录' };
      d.users[acc].kyc = {
        status: 'pending',
        name: name[0] + '*'.repeat(Math.max(1, name.length - 1)),
        idNumber: idNumber.slice(0, 4) + '**********' + idNumber.slice(-4),
      };
      saveLocal(d);
      return { ok: true, status: 'pending', offline: true };
    });
  }

  /* ---------- 支付 ---------- */

  function payCreate(plan, method) {
    return probe().then(function (ok) {
      if (ok) return req('POST', '/api/pay/create', { plan: plan, method: method });
      var d = localDB();
      var orderId = 'LOCAL' + Date.now().toString().slice(-8);
      d.orders = d.orders || {};
      d.orders[orderId] = {
        orderId: orderId, plan: plan, method: method,
        amount: plan === 'year' ? 11800 : 1900, status: 'pending', createdAt: Date.now(),
      };
      saveLocal(d);
      return {
        ok: true, orderId: orderId, amount: d.orders[orderId].amount, status: 'pending',
        codeUrl: 'snag://pay/' + orderId, expiresAt: Date.now() + 900000,
        methodName: { wechat: '微信支付', alipay: '支付宝', card: '银行卡' }[method],
        offline: true,
      };
    });
  }
  function payQuery(orderId) {
    return probe().then(function (ok) {
      if (ok) return req('GET', '/api/pay/query?orderId=' + encodeURIComponent(orderId));
      var d = localDB();
      var o = (d.orders || {})[orderId];
      if (!o) return { ok: false, msg: '订单不存在' };
      return { ok: true, orderId: o.orderId, status: o.status, amount: o.amount, paidAt: o.paidAt };
    });
  }
  // 演示专用：真实环境这一步是支付平台的异步回调，且必须验签
  function payMock(orderId) {
    return probe().then(function (ok) {
      if (ok) return req('POST', '/api/pay/mockpay', { orderId: orderId });
      var d = localDB();
      var o = (d.orders || {})[orderId];
      if (!o) return { ok: false, msg: '订单不存在' };
      o.status = 'paid'; o.paidAt = Date.now();
      var acc = String(token).replace(/^local\./, '');
      if (d.users && d.users[acc]) d.users[acc].subscribed = true;
      saveLocal(d);
      return { ok: true, status: 'paid', paidAt: o.paidAt, offline: true };
    });
  }

  /* ---------- AI 智能客服 ---------- */
  function aiChat(messages) {
    return probe().then(function (ok) {
      if (!ok) return { ok: true, demo: true, text: '客服助手当前离线，你可以问我：怎么发布闲置、会员收费、怎么定位、遇到骗子怎么办。' };
      return req('POST', '/api/ai/chat', { messages: messages });
    }).catch(function () {
      return { ok: true, demo: true, text: '网络开了小差，稍后再试～也可以问我：怎么发布闲置、会员多少钱。' };
    });
  }

  /* ---------- 发布闲置 / 邀请裂变 / 举报 / 社交证明 ---------- */
  function listingCreate(payload) {
    return probe().then(function (ok) {
      if (!ok) return { ok: false, offline: true, msg: '离线模式暂不支持发布' };
      return req('POST', '/api/listings', payload);
    });
  }
  function listingsMine() {
    return probe().then(function (ok) { return ok ? req('GET', '/api/listings/mine') : { ok: true, listings: [], offline: true }; });
  }
  function listingsPublic(city) {
    return probe().then(function (ok) { return ok ? req('GET', '/api/listings' + (city ? '?city=' + city : '')) : { ok: true, listings: [] }; });
  }
  function listingDelete(id) {
    return probe().then(function (ok) { return ok ? req('POST', '/api/listings/delete', { id: id }) : { ok: false, offline: true }; });
  }
  function inviteBind(code) {
    return probe().then(function (ok) { return ok ? req('POST', '/api/invite/bind', { code: code }) : { ok: false, offline: true }; });
  }
  function inviteRedeem() {
    return probe().then(function (ok) { return ok ? req('POST', '/api/invite/redeem') : { ok: false, offline: true }; });
  }
  function report(targetType, targetId, reason) {
    return probe().then(function (ok) { return ok ? req('POST', '/api/report', { targetType: targetType, targetId: targetId, reason: reason }) : { ok: false, offline: true }; });
  }
  function social(city) {
    return probe().then(function (ok) { return ok ? req('GET', '/api/social' + (city ? '?city=' + city : '')) : { ok: true, givingNearby: 1200, claimedWeek: 860 }; });
  }

  /* ---------- 埋点 ---------- */

  function track(name, props) {
    if (online === false) return Promise.resolve({ ok: true });
    return probe().then(function (ok) {
      if (!ok) return { ok: true };
      return req('POST', '/api/track', { name: name, props: props || {} });
    }).catch(function () { return { ok: false }; });
  }

  /* ---------- 账号注销（合规：用户须能删除自己的账号与数据） ---------- */
  function accountDelete() {
    return probe().then(function (ok) {
      if (!ok) return { ok: false, offline: true };
      return req('POST', '/api/account/delete');
    });
  }

  return {
    BASE: BASE, probe: probe, isOnline: function () { return online; },
    getToken: getToken, setToken: setToken, logout: logout,
    sendCode: sendCode, verify: verify, me: me,
    idCardValid: idCardValid, kycSubmit: kycSubmit,
    payCreate: payCreate, payQuery: payQuery, payMock: payMock,
    aiChat: aiChat,
    listingCreate: listingCreate, listingsMine: listingsMine, listingsPublic: listingsPublic,
    listingDelete: listingDelete, inviteBind: inviteBind, inviteRedeem: inviteRedeem,
    report: report, social: social,
    accountDelete: accountDelete,
    track: track,
  };
})();
