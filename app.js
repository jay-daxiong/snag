/* Snag 原型 · 交互逻辑
 * 智能计算交给 SnagEngine，网络请求交给 Api，这一层只负责界面与状态。
 */

(function () {
  'use strict';

  var LS = {
    fav: 'snag.fav', sub: 'snag.sub', opens: 'snag.opens', bell: 'snag.bell',
    alerts: 'snag.alerts', prefs: 'snag.prefs', claimed: 'snag.claimed',
    night: 'snag.night', font: 'snag.font', onboarded: 'snag.onboarded',
    nightQ: 'snag.nightq', badges: 'snag.badges', city: 'snag.city',
    origin: 'snag.origin', theme: 'snag.theme', history: 'snag.history',
  };
  var FREE_OPENS = 3;
  var FREE_LIST_COUNT = 6;
  var E = SnagEngine;

  function loadJSON(k, f) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : f; }
    catch (e) { return f; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var state = {
    tab: 'home', view: 'list', cat: 'all', sort: 'smart',
    radius: 99, maxMinutes: 99999, query: '',
    cityKey: loadJSON(LS.city, 'shanghai'),
    origin: loadJSON(LS.origin, null),
    favorites: loadJSON(LS.fav, []),
    subscribed: loadJSON(LS.sub, false),
    freeOpens: loadJSON(LS.opens, 0),
    bellOn: loadJSON(LS.bell, false),
    alerts: loadJSON(LS.alerts, []),
    prefs: loadJSON(LS.prefs, null),
    claimed: loadJSON(LS.claimed, []),
    nightMode: loadJSON(LS.night, false),
    largeFont: loadJSON(LS.font, false),
    darkMode: loadJSON(LS.theme, false),
    onboarded: loadJSON(LS.onboarded, false),
    nightQueue: loadJSON(LS.nightQ, []),
    history: loadJSON(LS.history, []),
    auth: { user: null, kyc: null },
    selectedId: null,
    scene: null,
  };

  var ALL = [];
  var ORIGIN = { lat: 0, lon: 0 };

  var $ = function (s) { return document.querySelector(s); };
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= 基础 ================= */

  function timeAgo(min) {
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    if (min < 1440) return Math.floor(min / 60) + ' 小时前';
    return Math.floor(min / 1440) + ' 天前';
  }
  function distText(km) {
    return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km';
  }
  function catOf(it) { return CATEGORIES[it.category] || CATEGORIES.other; }
  function iconTag(it) { return '<svg aria-hidden="true"><use href="#ic-' + it.category + '"></use></svg>'; }
  function byId(id) { return ALL.filter(function (x) { return x.id === id; })[0]; }
  function greeting() {
    var h = new Date().getHours();
    if (h < 6) return '夜深了，明早再看也不迟';
    if (h < 11) return '早上好，刚搬出来的东西通常最多';
    if (h < 14) return '中午好，午休时间适合刷两眼';
    if (h < 18) return '下午好，今天有不少新发布的';
    return '晚上好，晚间是发布高峰';
  }
  function isQuietHour() {
    var h = new Date().getHours();
    return state.nightMode && (h >= 22 || h < 8);
  }

  // 轻量埋点：name 对应后台功能决策矩阵
  function trk(name, props) { Api.track(name, props || {}); }

  /* ================= 城市与定位 ================= */

  function loadCity(key, origin) {
    if (!CITIES[key]) key = '3101';
    state.cityKey = key;
    ALL = itemsOf(key);
    ORIGIN = origin || { lat: CITIES[key].center.lat, lon: CITIES[key].center.lon };
    ALL.forEach(function (it) {
      it.distanceKm = E.distKm(ORIGIN.lat, ORIGIN.lon, it.lat, it.lon);
    });
    saveJSON(LS.city, key);
    saveJSON(LS.origin, ORIGIN);
    placeLabel();
    renderLocBar();
  }

  // 顶部位置标签：省 / 市 / 县（有定位时显示更细）
  function placeLabel() {
    var c = CITIES[state.cityKey] || CITIES['3101'];
    var prov = (R && R.provinceOf(c.provinceCode)) ? R.provinceOf(c.provinceCode).name : '';
    var txt = c.name;
    if (state.region && state.region.county && state.region.cityKey === state.cityKey) {
      txt = prov + ' · ' + c.name + ' · ' + state.region.county;
    } else if (prov && prov !== c.name) {
      txt = prov + ' · ' + c.name;
    }
    $('#placeLabel').textContent = txt;
  }

  function renderLocBar() {
    var el = $('#locBar');
    if (!state.origin) { el.hidden = true; return; }
    el.hidden = false;
    var o = state.origin;
    var where = (state.region && state.region.county) ? (o.label + ' · ' + state.region.county)
      : (o.label || (CITIES[state.cityKey] && CITIES[state.cityKey].name) || '');
    el.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
      '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<circle cx="12" cy="10" r="2.2" fill="currentColor"/></svg>' +
      '<span>已定位到 ' + esc(where) + '，距离按你实际位置计算' +
        (o.accuracy ? '（精度约 ' + Math.round(o.accuracy) + ' m）' : '') + '</span>' +
      '<button data-clearloc="1">清除</button>';
  }

  // 一键定位：调用浏览器原生 Geolocation，这是真实可用的功能
  function locate() {
    if (!navigator.geolocation) {
      toast('没法定位', '这个浏览器不支持定位，请手动选城市', null);
      openCityDrawer();
      return;
    }
    toast('定位中', '正在获取你的位置…', null);
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      var res = applyLocation(lat, lon);
      state.region = {
        cityKey: res.cityKey, province: res.province, county: res.county,
        accuracyNote: res.accuracy, cityDistanceKm: res.cityDistanceKm,
      };
      state.origin = {
        lat: lat, lon: lon, accuracy: pos.coords.accuracy,
        label: res.province && res.province !== res.city.name ? res.province + '·' + res.city.name : res.city.name,
        at: Date.now(),
      };
      var changed = res.cityKey !== state.cityKey;
      loadCity(res.cityKey, { lat: lat, lon: lon });
      renderChips(); renderStats(); renderMain();
      toast(changed ? '已定位并切到' + res.city.name : '定位成功',
        (res.county ? '定位到 ' + res.city.name + ' · ' + res.county + '，' : '检测到你在' + res.city.name + '，') +
        (changed ? '已换成本地数据' : '距离已按实际位置重算') +
        '（' + res.accuracy + '）', null);
      Api.track('locate', { city: res.cityKey, province: res.province, county: res.county || '' });
      refineCounty(lat, lon);
    }, function (err) {
      var msg = err && err.code === 1 ? '你拒绝了定位授权' : '定位失败';
      toast(msg, '可以手动选一个城市', null);
      openCityDrawer();
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  // 在线逆地理编码升级「区/县」：离线已精准到市，这里联网补齐县。
  // 不阻塞主流程；离线 / 接口不可达时静默跳过，退回离线结果。
  function refineCounty(lat, lon, silent) {
    if (!state.region || typeof window.reverseGeocodeOnline !== 'function') return;
    window.reverseGeocodeOnline(lat, lon).then(function (on) {
      if (!on || !on.county || on.county === '市辖区') return;
      state.region.county = on.county;
      state.region.accuracyNote = '已精确到区/县（在线逆地理编码）';
      placeLabel(); renderLocBar();
      if (!silent) toast('已精确到', on.county + '（在线逆地理编码）', null);
    }).catch(function () {});
  }

  function openCityDrawer() {
    // 热门城市
    $('#cityGrid').innerHTML = HOT_CITIES.map(function (k) {
      var on = String(k) === String(state.cityKey);
      var n = itemsOf(k).length;
      return '<button class="cityc' + (on ? ' on' : '') + '" data-city="' + k + '">' +
        '<b>' + CITIES[k].name + '</b><span>' + n + ' 件</span></button>';
    }).join('');
    // 级联：省 -> 市 -> 县
    var provSel = $('#provSel'), citySel = $('#citySel'), countySel = $('#countySel');
    if (R && R.provinces) {
      provSel.innerHTML = '<option value="">省/直辖市</option>' + R.provinces.map(function (p) {
        return '<option value="' + p.code + '">' + p.name + '</option>';
      }).join('');
      var cur = CITIES[state.cityKey];
      if (cur) {
        provSel.value = cur.provinceCode;
        fillCitySel(cur.provinceCode, cur.code);
        fillCountySel(cur.code, state.region && state.region.cityKey === state.cityKey ? state.region.county : null);
      } else {
        citySel.innerHTML = '<option value="">城市</option>';
        countySel.innerHTML = '<option value="">区/县</option>';
      }
    }
    $('#cascadeGo').disabled = true;
    $('#cityDrawer').hidden = false;
  }

  function fillCitySel(provCode, selCode) {
    var citySel = $('#citySel'), countySel = $('#countySel');
    var list = R.cities.filter(function (c) { return String(c.provinceCode) === String(provCode); });
    citySel.innerHTML = '<option value="">城市</option>' + list.map(function (c) {
      return '<option value="' + c.code + '">' + c.name + '</option>';
    }).join('');
    citySel.value = selCode || '';
    countySel.innerHTML = '<option value="">区/县</option>';
    $('#cascadeGo').disabled = true;
  }

  function fillCountySel(cityCode, selName) {
    var countySel = $('#countySel');
    var list = R.countiesOf(cityCode) || [];
    countySel.innerHTML = '<option value="">区/县（可选）</option>' + list.map(function (x) {
      return '<option value="' + x.name + '">' + x.name + '</option>';
    }).join('');
    countySel.value = selName || '';
    $('#cascadeGo').disabled = !cityCode;
  }

  function applyCascade() {
    var code = $('#citySel').value;
    if (!code) return;
    var city = CITIES[code];
    state.region = {
      cityKey: code, province: (R.provinceOf(city.provinceCode) || {}).name || '',
      county: $('#countySel').value || null,
    };
    state.origin = null;
    saveJSON(LS.origin, null);
    loadCity(code);
    $('#cityDrawer').hidden = true;
    renderChips(); renderStats(); renderMain();
    var where = state.region.county ? (city.name + ' · ' + state.region.county) : city.name;
    toast('已切换到' + where, itemsOf(code).length + ' 件免费好物', null);
    Api.track('city_pick', { city: code, county: state.region.county || '' });
    // 用户未手选具体县时，联网把县补齐（仅当离线为市辖区）
    if (!state.region.county || state.region.county === '市辖区') {
      var cc = R.cityOf(code);
      if (cc) refineCounty(cc.lat, cc.lon, true);
    }
  }

  /* ================= 登录 ================= */

  var authType = 'phone';
  var sendTimer = null, sendLeft = 0;

  function openAuth() {
    $('#authLayer').hidden = false;
    setAuthType('phone');
  }
  function setAuthType(t) {
    authType = t;
    each('.atab', function (b) { b.classList.toggle('is-on', b.getAttribute('data-atab') === t); });
    var inp = $('#authAccount');
    inp.placeholder = t === 'phone' ? '请输入手机号' : '请输入邮箱';
    inp.value = '';
    $('#authCode').value = '';
    $('#authTip').textContent = '';
  }
  function validAccount(t, v) {
    return t === 'phone' ? /^1[3-9]\d{9}$/.test(v) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }
  function sendCode() {
    var acc = $('#authAccount').value.trim();
    if (!validAccount(authType, acc)) {
      $('#authTip').textContent = authType === 'phone' ? '手机号格式不对' : '邮箱格式不对';
      return;
    }
    $('#authSend').disabled = true;
    Api.sendCode(authType, acc).then(function (r) {
      $('#authSend').disabled = false;
      if (!r.ok) { $('#authTip').textContent = r.msg || '发送失败'; return; }
      $('#authTip').innerHTML = '演示验证码：<b>' + r.code + '</b>' +
        (r.offline ? '（后端未启动，走本地模拟）' : '（真实环境不会显示）');
      sendLeft = 60;
      clearInterval(sendTimer);
      sendTimer = setInterval(function () {
        sendLeft--;
        $('#authSend').textContent = sendLeft > 0 ? sendLeft + ' s' : '重新获取';
        if (sendLeft <= 0) { clearInterval(sendTimer); $('#authSend').disabled = false; }
      }, 1000);
      $('#authSend').disabled = true;
    });
  }
  function submitAuth() {
    var acc = $('#authAccount').value.trim();
    var code = $('#authCode').value.trim();
    if (!validAccount(authType, acc)) { $('#authTip').textContent = '账号格式不对'; return; }
    if (!/^\d{6}$/.test(code)) { $('#authTip').textContent = '请输入 6 位验证码'; return; }
    Api.verify(authType, acc, code, window.SNAG && window.SNAG.inviteCode ? window.SNAG.inviteCode : undefined).then(function (r) {
      if (!r.ok) { $('#authTip').textContent = r.msg || '登录失败'; return; }
      state.auth.user = r.user;
      $('#authLayer').hidden = true;
      toast(r.isNew ? '注册成功' : '欢迎回来', r.isNew ? '已自动为你创建账号' : acc, null);
      Api.me().then(function (m) { if (m.ok) state.auth.kyc = m.kyc; });
      Api.track(r.isNew ? 'signup' : 'login', { type: authType });
      renderMain();
    });
  }

  /* ================= 实名认证 ================= */

  function openKyc() {
    trk('kyc_view', {});
    var k = state.auth.kyc;
    var cur = k
      ? '<div class="kyc-state ' + k.status + '">' +
        '<b>' + (k.status === 'approved' ? '已实名' : k.status === 'pending' ? '审核中' : '未通过') + '</b>' +
        '<span>' + esc(k.name || '') + ' · ' + esc(k.idNumber || '') + '</span></div>'
      : '';
    $('#kycBody').innerHTML =
      '<h2 class="msg-h">实名认证</h2>' +
      '<p class="msg-sub">领取大件家具、婴儿用品时，对方通常希望确认你是真人。认证后对方更愿意把东西留给你。</p>' +
      cur +
      '<label class="fld"><span>真实姓名</span><input id="kycName" class="auth-input" placeholder="请输入姓名" autocomplete="off"></label>' +
      '<label class="fld"><span>身份证号</span><input id="kycId" class="auth-input" maxlength="18" placeholder="18 位身份证号" autocomplete="off"></label>' +
      '<p class="auth-tip" id="kycTip"></p>' +
      '<button class="pw-cta" id="kycSubmit">提交认证</button>' +
      '<p class="auth-fine">前端用 GB 11643 的校验位算法做真实性检查，但<b>没有</b>对接公安库。真实产品必须接第三方实名服务。</p>';
    $('#kycSheet').hidden = false;
  }
  function submitKyc() {
    if (!Api.getToken()) {
      $('#kycTip').textContent = '请先登录';
      return;
    }
    var name = $('#kycName').value.trim();
    var idn = $('#kycId').value.trim();
    if (name.length < 2) { $('#kycTip').textContent = '请填写真实姓名'; return; }
    if (!Api.idCardValid(idn)) { $('#kycTip').textContent = '身份证号校验不通过，请检查'; return; }
    Api.kycSubmit(name, idn).then(function (r) {
      if (!r.ok) { $('#kycTip').textContent = r.msg || '提交失败'; return; }
      state.auth.kyc = { status: 'pending', name: name[0] + '*'.repeat(Math.max(1, name.length - 1)), idNumber: idn.slice(0, 4) + '**********' + idn.slice(-4) };
      $('#kycSheet').hidden = true;
      trk('kyc', {});
      toast('已提交', '后台审核通过后会通知你', null);
      renderMain();
    });
  }

  /* ================= 支付 ================= */

  var payOrder = null, payTimer = null;

  function qrSVG(seedStr, size) {
    var n = 21, cell = 100 / n;
    var s = 31;
    for (var i = 0; i < seedStr.length; i++) s = (s * 131 + seedStr.charCodeAt(i)) % 1000003;
    var out = '';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        s = (s * 1103515245 + 12345) % 2147483648;
        var isEye = (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
        if (isEye) continue;
        if ((s / 2147483648) > 0.52) out += '<rect x="' + (x * cell) + '" y="' + (y * cell) + '" width="' + cell + '" height="' + cell + '"/>';
      }
    }
    return '<svg viewBox="0 0 100 100" width="' + (size || 130) + '" height="' + (size || 130) + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="支付二维码占位图案">' +
      '<rect width="100" height="100" fill="#fff"/><g fill="#111">' + out +
      '<rect x="0" y="0" width="21" height="21"/><rect x="7" y="7" width="7" height="7" fill="#fff"/>' +
      '<rect x="79" y="0" width="21" height="21"/><rect x="86" y="7" width="7" height="7" fill="#fff"/>' +
      '<rect x="0" y="79" width="21" height="21"/><rect x="7" y="86" width="7" height="7" fill="#fff"/>' +
      '</g></svg>';
  }

  function openPay(plan, method) {
    if (!Api.getToken()) {
      toast('请先登录', '登录后才能开通会员', null);
      openAuth();
      return;
    }
    trk('subscribe_view', { plan: plan || 'month' });
    plan = plan || 'month';
    method = method || 'wechat';
    Api.payCreate(plan, method).then(function (r) {
      if (!r.ok) { toast('下单失败', r.msg || '', null); return; }
      payOrder = r;
      renderPay(r);
      $('#paySheet').hidden = false;
      clearInterval(payTimer);
      payTimer = setInterval(function () { pollPay(); }, 2500);
    });
  }
  function renderPay(o) {
    var yuan = (o.amount / 100).toFixed(2);
    $('#payBody').innerHTML =
      '<h2 class="msg-h">' + esc(o.methodName || '支付') + ' · ¥' + yuan + '</h2>' +
      '<p class="msg-sub">订单号 ' + esc(o.orderId) + '</p>' +
      '<div class="pay-methods">' +
        ['wechat', 'alipay', 'card'].map(function (m) {
          var nm = { wechat: '微信', alipay: '支付宝', card: '银行卡' }[m];
          return '<button class="pm' + (payOrder && payOrder.method === m ? ' on' : '') +
            '" data-method="' + m + '">' + nm + '</button>';
        }).join('') +
      '</div>' +
      '<div class="pay-qr">' + qrSVG(o.orderId, 132) + '</div>' +
      '<p class="pay-note">这是<b>占位图案</b>，不是真实二维码，扫了也没用。真实环境这里应是支付平台返回的链接或码。</p>' +
      '<button class="pw-cta" id="payDone">我已完成支付（模拟回调）</button>' +
      '<div class="pay-status" id="payStatus">等待支付…</div>' +
      '<p class="auth-fine">完整链路：创建订单 → 展示支付码 → 轮询查询 → 平台回调 → 开通会员。真实对接只需替换下单与回调两个接口。</p>';
  }
  function pollPay() {
    if (!payOrder || payOrder.status === 'paid') { clearInterval(payTimer); return; }
    Api.payQuery(payOrder.orderId).then(function (r) {
      if (r.ok && r.status === 'paid') finishPay(r);
      else if ($('#payStatus')) $('#payStatus').textContent = '等待支付…';
    });
  }
  function finishPay() {
    clearInterval(payTimer);
    payOrder.status = 'paid';
    state.subscribed = true;
    saveJSON(LS.sub, true);
    trk('subscribe', { plan: payOrder.plan, method: payOrder.method });
    var st = $('#payStatus');
    if (st) st.innerHTML = '<b>支付成功，会员已开通</b>';
    toast('支付成功', '全城免费好物已解锁', null);
    setTimeout(function () { $('#paySheet').hidden = true; renderMain(); }, 900);
  }

  /* ================= 过滤与排序 ================= */

  function filtered() {
    var p = E.parseQuery(state.query, CITIES[state.cityKey].districts);
    return ALL.filter(function (it) {
      if (state.cat !== 'all' && it.category !== state.cat) return false;
      if (p.cats && p.cats.indexOf(it.category) === -1) return false;
      if (p.district && it.district !== p.district) return false;
      if (it.distanceKm > state.radius) return false;
      if (p.maxDist && it.distanceKm > p.maxDist) return false;
      if (it.minutesAgo > state.maxMinutes) return false;
      if (p.freshOnly && it.minutesAgo > 180) return false;
      if (p.condNew && E.signals(it).condition !== '几乎全新') return false;
      if (p.kw && it.tokens.indexOf(p.kw) === -1) return false;
      return true;
    });
  }
  function smartScore(it) {
    var near = 1 - Math.min(it.distanceKm / 6, 1);
    var fresh = 1 - Math.min(it.minutesAgo / 4320, 1);
    var pref = (state.prefs && state.prefs[it.category]) || 0;
    var v = 0.45 * E.hotScore(it) + 25 * near + 20 * fresh + pref * 8;
    if (E.likelyGone(it)) v -= 45;
    if (state.claimed.indexOf(it.id) !== -1) v -= 120;
    if (E.risk(it).level === 'danger') v -= 60;
    return v;
  }
  function sortItems(list) {
    var s = state.sort, arr = list.slice();
    if (s === 'fresh') return arr.sort(function (a, b) { return a.minutesAgo - b.minutesAgo; });
    if (s === 'near') return arr.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
    if (s === 'value') return arr.sort(function (a, b) { return E.estValue(b) - E.estValue(a); });
    if (s === 'safe') {
      return arr.sort(function (a, b) {
        var ga = E.likelyGone(a), gb = E.likelyGone(b);
        if (ga !== gb) return ga ? 1 : -1;
        return a.minutesAgo - b.minutesAgo;
      });
    }
    return arr.sort(function (a, b) { return smartScore(b) - smartScore(a); });
  }

  /* ================= 卡片 ================= */

  function tagRow(it) {
    var sg = E.signals(it);
    if (!sg.tags.length) return '';
    return '<div class="ctags">' + sg.tags.map(function (t) {
      var cls = t === '急出' ? ' hot' : t === '大件需搬运' ? ' warn' : '';
      return '<i class="tg' + cls + '">' + esc(t) + '</i>';
    }).join('') + '</div>';
  }
  function cardHTML(it, opts) {
    opts = opts || {};
    var c = catOf(it);
    var favd = state.favorites.indexOf(it.id) !== -1;
    var score = E.hotScore(it);
    var gone = E.likelyGone(it);
    var want = E.wantedCount(it);
    var claimed = state.claimed.indexOf(it.id) !== -1;
    var rk = E.risk(it);

    var badges = '';
    if (rk.level === 'danger') badges += '<span class="badge danger">疑似收费套路</span>';
    else if (rk.level === 'warn') badges += '<span class="badge warn">信息需确认</span>';
    if (claimed) badges += '<span class="badge ok">已拿到</span>';
    else if (gone) badges += '<span class="badge dim">可能已被领走</span>';
    else badges += '<span class="badge' + (score >= 64 ? ' fire' : '') + '">' + E.remainingText(it) + '</span>';
    if (want >= 4) badges += '<span class="badge dim">' + want + ' 人想要</span>';

    var body =
      '<div class="cov" style="background:' + c.tone + ';color:' + c.color + '">' +
        '<span class="free">FREE</span>' + iconTag(it) + '</div>' +
      '<div class="cbody">' +
        '<div class="crow"><h3 class="ctitle">' + esc(it.title) + '</h3></div>' +
        '<p class="cdesc">' + E.summary(it) + '</p>' +
        tagRow(it) +
        '<div class="cbadges">' + badges + '</div>' +
        '<div class="cmeta"><b>' + distText(it.distanceKm) + '</b><i class="dotsep"></i>' +
          '<span>' + timeAgo(it.minutesAgo) + '</span><i class="dotsep"></i>' +
          '<span>' + esc(it.district) + '</span>' +
          '<button class="heart' + (favd ? ' is-on' : '') + '" data-fav="' + it.id + '" aria-label="收藏">' +
            '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
            '<path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.6 12 20 12 20z" ' +
            'fill="' + (favd ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
          '</button></div>' +
      '</div>';

    var lock = opts.locked
      ? '<div class="lockmask"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
        '<path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
        '</svg>开通后可查看</div>'
      : '';
    return '<article class="card' + (opts.locked ? ' is-locked' : '') + (gone && !claimed ? ' is-gone' : '') +
      (rk.level === 'danger' ? ' is-risk' : '') + '" data-id="' + it.id + '">' + body + lock + '</article>';
  }

  /* ================= 列表 ================= */

  function renderList() {
    var list = sortItems(filtered());
    var html = '';

    if (state.scene) {
      var b = E.bundle(list.length ? list : ALL, state.scene);
      if (b && b.items.length) {
        html += '<div class="bundle">' +
          '<div class="bundle-head"><span>AI 搭配 · ' + esc(b.label) + '</span>' +
          '<button data-closescene="1">收起</button></div>' +
          '<div class="bundle-items">' + b.items.map(function (it) {
            var c = catOf(it);
            return '<button class="bi" data-open="' + it.id + '">' +
              '<i style="background:' + c.tone + ';color:' + c.color + '">' + iconTag(it) + '</i>' +
              '<b>' + esc(it.title) + '</b><em>' + distText(it.distanceKm) + '</em></button>';
          }).join('') + '</div>' +
          '<p class="route-note">按抢手程度和距离挑的一套，合计估值约 ¥' + b.total + '。' +
          '已自动排除失效件和有收费风险的帖子。</p></div>';
      }
    }

    var recos = [];
    if (state.prefs && !state.query && state.cat === 'all' && state.sort === 'smart') {
      recos = E.recommend(list, state.prefs, 3, state.claimed);
    }
    if (recos.length) {
      if (!state._recoTracked) { trk('recommend', { n: recos.length }); state._recoTracked = true; }
      html += '<div class="sechead"><span>为你推荐</span><small>根据你看过和收藏的品类</small></div>';
      html += recos.map(function (it) { return cardHTML(it, {}); }).join('');
      html += '<div class="sechead"><span>' + CITIES[state.cityKey].name + '全部</span><small>按抢手程度排序</small></div>';
    }
    html += list.map(function (it, i) {
      var isReco = false;
      for (var j = 0; j < recos.length; j++) if (recos[j].id === it.id) isReco = true;
      return cardHTML(it, { locked: !state.subscribed && i >= FREE_LIST_COUNT && !isReco });
    }).join('');

    $('#cardList').innerHTML = html;
    $('#resultCount').textContent = list.length + ' 件';
    var none = list.length === 0;
    $('#emptyState').hidden = !none;
    $('#cardList').hidden = none;
    if (none) {
      $('#emptyState').innerHTML = '<div class="empty-ico"></div><p>这个条件下还没有东西</p>' +
        '<small>放宽距离或时间，或者换个城市</small>';
    }
  }

  function renderScenes() {
    $('#sceneRow').innerHTML = Object.keys(E.SCENES).map(function (k) {
      return '<button class="scene' + (state.scene === k ? ' on' : '') + '" data-scene="' + k + '">' +
        E.SCENES[k].label + '</button>';
    }).join('');
  }

  /* ================= 地图 ================= */

  function renderMap() {
    var list = sortItems(filtered());
    $('#resultCount').textContent = list.length + ' 件';
    var W = 340, H = 320, PAD = 26;
    var pts = list.concat([{ lat: ORIGIN.lat, lon: ORIGIN.lon }]);
    var lats = pts.map(function (p) { return p.lat; }), lons = pts.map(function (p) { return p.lon; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
    var spanLat = Math.max(maxLat - minLat, 0.001), spanLon = Math.max(maxLon - minLon, 0.001);
    function px(lat, lon) {
      return {
        x: PAD + ((lon - minLon) / spanLon) * (W - PAD * 2),
        y: PAD + ((maxLat - lat) / spanLat) * (H - PAD * 2),
      };
    }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="附近的免费物品分布地图">';
    s += '<rect width="' + W + '" height="' + H + '" fill="#EFF2EF"/>';
    s += '<path d="M0 232 C60 214 116 246 176 232 C236 218 292 244 340 232 L340 320 L0 320 Z" fill="#DCE7EA"/>';
    s += '<path d="M22 40 L86 26 L128 58 L96 96 Z" fill="#DFEAE0"/>';
    s += '<path d="M242 96 L316 84 L328 140 L256 148 Z" fill="#DFEAE0"/>';
    [46, 92, 138, 184, 264, 300].forEach(function (y) {
      s += '<line x1="-4" y1="' + y + '" x2="' + (W + 4) + '" y2="' + y + '" stroke="#FFFFFF" stroke-width="' + (y % 92 === 0 ? 7 : 4) + '"/>';
    });
    [72, 148, 226, 300].forEach(function (x) {
      s += '<line x1="' + x + '" y1="-4" x2="' + x + '" y2="' + (H + 4) + '" stroke="#FFFFFF" stroke-width="' + (x % 148 === 0 ? 7 : 4) + '"/>';
    });
    var me = px(ORIGIN.lat, ORIGIN.lon);
    s += '<circle cx="' + me.x.toFixed(1) + '" cy="' + me.y.toFixed(1) + '" r="19" fill="#0FA968" opacity="0.13"/>';
    s += '<circle cx="' + me.x.toFixed(1) + '" cy="' + me.y.toFixed(1) + '" r="8.5" fill="#0FA968" opacity="0.28"/>';
    s += '<circle cx="' + me.x.toFixed(1) + '" cy="' + me.y.toFixed(1) + '" r="4.5" fill="#0FA968" stroke="#fff" stroke-width="2"/>';

    list.forEach(function (it, i) {
      var p = px(it.lat, it.lon), c = catOf(it);
      var sel = state.selectedId === it.id;
      var lockedPin = !state.subscribed && i >= FREE_LIST_COUNT;
      var gone = E.likelyGone(it);
      var dimmed = lockedPin || gone;
      var col = E.risk(it).level === 'danger' ? '#C0392B' : dimmed ? '#A8AEA8' : c.color;
      if (!dimmed && E.hotScore(it) >= 64) {
        s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="13" fill="' + col + '" opacity="0.15"/>';
      }
      if (it.minutesAgo < 60 && !dimmed) {
        s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="10" fill="' + col + '" opacity="0.16"/>';
      }
      if (sel) s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="14" fill="' + col + '" opacity="0.2"/>';
      s += '<g class="map-pin" data-id="' + it.id + '"><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
        '" r="' + (sel ? 9 : 7) + '" fill="' + col + '" stroke="#fff" stroke-width="2.2"/></g>';
    });
    s += '</svg>';
    $('#mapCanvas').innerHTML = s;
    $('#emptyState').hidden = list.length !== 0;
    $('#mapCanvas').hidden = list.length === 0;

    var pick = state.selectedId ? byId(state.selectedId) : null;
    if (!pick) { $('#mapPick').hidden = true; return; }
    var pc = catOf(pick);
    $('#mapPick').hidden = false;
    $('#mapPick').innerHTML =
      '<div class="cov" style="background:' + pc.tone + ';color:' + pc.color + '">' + iconTag(pick) + '</div>' +
      '<div style="min-width:0;flex:1"><p class="mp-title">' + esc(pick.title) + '</p>' +
      '<p class="mp-meta">' + distText(pick.distanceKm) + ' · ' + E.remainingText(pick) + '</p></div>' +
      '<button class="btn primary" data-open="' + pick.id + '" style="flex:0 0 auto;padding:8px 13px;font-size:13px">查看</button>';
  }

  /* ================= 概览 ================= */

  function renderStats() {
    var today = ALL.filter(function (it) { return it.minutesAgo < 1440; }).length;
    var near = ALL.filter(function (it) { return it.distanceKm <= 3; }).length;
    var value = ALL.reduce(function (a, it) { return a + E.estValue(it); }, 0);
    $('#statToday').textContent = today;
    $('#statNear').textContent = near;
    $('#statValue').textContent = '¥' + value.toLocaleString('zh-CN');
    $('#greet').textContent = greeting();
  }

  /* ================= 详情 ================= */

  function pushHistory(id) {
    state.history = [id].concat(state.history.filter(function (x) { return x !== id; })).slice(0, 20);
    saveJSON(LS.history, state.history);
  }
  function openSheet(id) {
    var it = byId(id);
    if (!it) return;
    trk('detail', { cat: it.category, city: state.cityKey });
    var c = catOf(it), sg = E.signals(it), rk = E.risk(it);
    var favd = state.favorites.indexOf(it.id) !== -1;
    var claimed = state.claimed.indexOf(it.id) !== -1;
    var score = E.hotScore(it), vr = E.valueRange(it), want = E.wantedCount(it);

    var html = '<div class="sh-top">' +
        '<div class="cov" style="background:' + c.tone + ';color:' + c.color + '">' + iconTag(it) + '</div>' +
        '<div style="min-width:0"><h2>' + esc(it.title) + '</h2>' +
        '<div class="src">来自 ' + esc(it.source) + ' · ' + timeAgo(it.minutesAgo) + '</div></div></div>' +
      '<div class="sh-figure" style="background:' + c.tone + ';color:' + c.color + '">' +
        '<span class="free">免费自取</span>' + iconTag(it) + '</div>';

    if (rk.level !== 'none') {
      html += '<div class="riskbox ' + rk.level + '"><b>' +
        (rk.level === 'danger' ? '风险提示' : '需要确认') + '</b><p>' + esc(rk.text) + '</p></div>';
    }

    html += '<div class="hotbox"><div class="hot-top"><span>抢手指数</span><b>' + score + '</b></div>' +
        '<div class="hot-bar"><i style="width:' + score + '%"></i></div>' +
        '<p class="hot-note">' + (E.likelyGone(it) ? '挂得久又很抢手，很可能已经被领走了' : E.remainingText(it)) +
        ' · 已有 ' + want + ' 人想要</p></div>' +
      '<div class="aibox"><div class="aibox-head"><span class="ai-dot"></span>AI 已从原文提取</div>' +
        '<div class="ctags">' + (sg.tags.length ? sg.tags.map(function (t) {
          var cls = t === '急出' ? ' hot' : t === '大件需搬运' ? ' warn' : '';
          return '<i class="tg' + cls + '">' + esc(t) + '</i>';
        }).join('') : '<i class="tg">原文没写清楚</i>') + '</div>' +
        '<p class="sh-desc">' + esc(it.desc) + '</p></div>' +
      '<dl class="kv"><dt>距离</dt><dd class="dist">' + distText(it.distanceKm) + '</dd></dl>' +
      '<dl class="kv"><dt>位置</dt><dd>' + esc(it.district) + ' · ' + esc(it.address) + '</dd></dl>' +
      '<dl class="kv"><dt>估价区间</dt><dd>¥' + vr[0] + ' – ¥' + vr[1] + '</dd></dl>' +
      '<dl class="kv"><dt>转手可卖</dt><dd>约 ¥' + E.resale(it) +
        ' <span class="hint">原版 App 就把"免费拿到再转卖"当成一条卖点</span></dd></dl>' +
      '<dl class="kv"><dt>领取说明</dt><dd>' + esc(it.pickupNote) + '</dd></dl>' +
      '<dl class="kv"><dt>发布渠道</dt><dd>' + esc(it.source) + '</dd></dl>';

    var sim = E.similar(it, ALL, 3);
    if (sim.length) {
      html += '<div class="sechead" style="padding:14px 0 8px"><span>你可能还想拿</span></div>' +
        sim.map(function (x) { return cardHTML(x, {}); }).join('');
    }

    html += '<div class="sh-actions">' +
        '<button class="btn' + (favd ? ' is-on' : '') + '" data-fav="' + it.id + '">' + (favd ? '已收藏' : '收藏') + '</button>' +
        '<button class="btn primary" data-msg="' + it.id + '">联系对方</button></div>' +
      '<div class="sh-actions" style="margin-top:9px">' +
        '<button class="btn" data-share="' + it.id + '">复制分享文案</button>' +
        '<button class="btn" data-poster="' + it.id + '">分享海报</button>' +
        '<button class="btn ghost' + (claimed ? ' is-on' : '') + '" data-claim="' + it.id + '">' +
        (claimed ? '已记一笔 · 拿到了' : '我拿到了，记一笔') + '</button>' +
        '<button class="btn ghost" data-report="' + it.id + '">举报</button></div>';

    $('#sheetBody').innerHTML = html;
    $('#scrim').hidden = false;
    $('#sheet').hidden = false;
    pushHistory(it.id);
    Api.track('view', { cat: it.category });
  }
  function closeSheet() {
    $('#scrim').hidden = true;
    $('#sheet').hidden = true;
    $('#msgSheet').hidden = true;
  }

  /* ================= 联系草稿与分享 ================= */

  function timeWindow() {
    var h = new Date().getHours();
    if (h < 11) return '今天上午';
    if (h < 14) return '今天中午';
    if (h < 18) return '今天下午';
    if (h < 22) return '今晚';
    return '明天上午';
  }
  function draftMessage(it) {
    var sg = E.signals(it), extra;
    if (sg.heavy) extra = '东西比较重，我会带个人一起搬，不占你太多时间。';
    else if (sg.pickup) extra = '我自己过来搬，不用你帮忙。';
    else extra = '我动作很快，不会耽误你太久。';
    if (sg.urgent) extra += '看你比较急，我可以马上出发。';
    return '你好，我在 Snag 上看到你送的「' + it.title + '」，就在' + it.district + it.address +
      '附近，离我这边' + distText(it.distanceKm) + '。\n\n我' + timeWindow() + '可以过去自取，' + extra +
      '\n\n方便的话回我一下，谢谢！';
  }
  function openMsg(id) {
    var it = byId(id);
    if (!it) return;
    $('#msgBody').innerHTML =
      '<h2 class="msg-h">发给对方的话，已经替你写好了</h2>' +
      '<p class="msg-sub">改一改再发。礼貌，加上一个具体时间，是最容易拿到回复的两件事。</p>' +
      '<textarea id="msgText" class="msg-ta" rows="8">' + esc(draftMessage(it)) + '</textarea>' +
      '<div class="sh-actions"><button class="btn" data-copy="1">复制文本</button>' +
      '<button class="btn primary" data-sent="1">就这样发送</button></div>';
    $('#msgSheet').hidden = false;
  }
  function shareText(it) {
    return '在 Snag 上看到有人免费送「' + it.title + '」，就在' + CITIES[state.cityKey].name +
      it.district + '，离我' + distText(it.distanceKm) + '，估值约 ¥' + E.estValue(it) +
      '。' + E.remainingText(it) + '，想要的抓紧。';
  }
  function copyShare(id) {
    var it = byId(id);
    if (!it) return;
    copyStr(shareText(it) + '\n（来自 Snag 免费好物）', '分享文案已复制到剪贴板');
  }
  function copyStr(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {}, function () {});
      ok = true;
    }
    ta.remove();
    toast(ok ? '已复制' : '请手动复制', ok ? okMsg : '这个环境不允许自动复制', null);
  }

  /* ================= 我拿到了 ================= */

  function claimedValue() {
    return state.claimed.reduce(function (a, id) { var it = byId(id); return a + (it ? E.estValue(it) : 0); }, 0);
  }
  function claimedCats() {
    var m = {};
    state.claimed.forEach(function (id) { var it = byId(id); if (it) m[it.category] = 1; });
    return Object.keys(m).length;
  }
  var BADGES = [
    { key: 'first', name: '第一件', desc: '开局了' },
    { key: 'k1', name: '省下四位数', desc: '累计 ¥1000+' },
    { key: 'five', name: '熟练捡漏', desc: '拿到 5 件' },
    { key: 'multi', name: '全面开花', desc: '覆盖 3 个品类' },
  ];
  function claim(id) {
    var it = byId(id);
    if (!it || state.claimed.indexOf(id) !== -1) return;
    var before = loadJSON(LS.badges, []);
    state.claimed.push(id);
    saveJSON(LS.claimed, state.claimed);
    var after = BADGES.filter(function (b) {
      return (b.key === 'first' && state.claimed.length >= 1) ||
        (b.key === 'k1' && claimedValue() >= 1000) ||
        (b.key === 'five' && state.claimed.length >= 5) ||
        (b.key === 'multi' && claimedCats() >= 3);
    }).map(function (b) { return b.key; });
    saveJSON(LS.badges, after);
    var fresh = after.filter(function (k) { return before.indexOf(k) === -1; });
    toast('记下了', '这件省了 ¥' + E.estValue(it) + '，累计 ¥' + claimedValue(), it);
    if (fresh.length) {
      var b = BADGES.filter(function (x) { return x.key === fresh[fresh.length - 1]; })[0];
      setTimeout(function () { toast('新成就', b.name + ' · ' + b.desc, null); }, 1000);
    }
    Api.track('claim', { cat: it.category });
    trk('got_it', { cat: it.category });
    renderMain();
    if (!$('#sheet').hidden) openSheet(id);
  }

  /* ================= 收藏 / 提醒 / 我的 ================= */

  function renderSaved() {
    var favs = ALL.filter(function (it) { return state.favorites.indexOf(it.id) !== -1; });
    var html = '';
    if (favs.length >= 2) {
      var r = E.route(favs, ORIGIN);
    if (!state._routeTracked) { trk('route_plan', { n: favs.length }); state._routeTracked = true; }
      html += '<div class="routebox"><div class="route-head"><span>顺路捡路线</span><b>共 ' +
        r.totalKm.toFixed(1) + ' km</b></div><ol class="route-list">' +
        r.order.map(function (it, i) {
          return '<li><i>' + (i + 1) + '</i><span>' + esc(it.title) + '</span><em>' +
            distText(it.distanceKm) + '</em></li>';
        }).join('') + '</ol>' +
        '<p class="route-note">从你现在的位置出发，按这个顺序走一趟就能拿完。按直线距离估算，实际路程以地图导航为准。</p>' +
        (claimedValue() ? '<p class="route-note">你已经累计省下 ¥' + claimedValue() + '。</p>' : '') + '</div>';
    }
    html += favs.map(function (it) { return cardHTML(it, {}); }).join('');
    $('#cardList').innerHTML = html;
    $('#cardList').hidden = favs.length === 0;
    $('#emptyState').hidden = favs.length !== 0;
    $('#resultCount').textContent = favs.length + ' 件';
    if (!favs.length) {
      $('#emptyState').innerHTML = '<div class="empty-ico"></div><p>还没有收藏</p>' +
        '<small>收藏到两件以上，会给你排一条顺路的路线</small>';
    }
  }

  function renderAlerts() {
    var pending = state.nightQueue.length;
    var html = '<div class="routebox"><div class="route-head"><span>提醒设置</span><b>' +
      (state.bellOn ? '已开启' : '已关闭') + '</b></div>' +
      '<div class="swrow"><span>实时提醒</span><button class="sw' + (state.bellOn ? ' on' : '') +
      '" data-toggle="bell"><i></i></button></div>' +
      '<div class="swrow"><span>夜间免打扰<i>22:00 – 08:00 不打扰，早上汇总成一条</i></span>' +
      '<button class="sw' + (state.nightMode ? ' on' : '') + '" data-toggle="night"><i></i></button></div>' +
      (pending ? '<div class="nightbox"><b>攒了 ' + pending + ' 条没打扰你</b>' +
        '<button class="btn primary" data-summary="1" style="margin-top:9px">看汇总</button></div>'
        : '<p class="route-note">开启提醒后，附近一有新货就通知你。' +
          (isQuietHour() ? '现在是免打扰时段，新消息不会弹出来。' : '') + '</p>') + '</div>';
    if (state.alerts.length) {
      html += '<div class="sechead"><span>最近通知</span><small>' + state.alerts.length + ' 条</small></div>';
      html += state.alerts.slice(0, 12).map(function (a) {
        var it = byId(a.id);
        return it ? cardHTML(it, {}) : '';
      }).join('');
    }
    $('#cardList').innerHTML = html;
    $('#cardList').hidden = false;
    $('#emptyState').hidden = true;
    $('#resultCount').textContent = '';
  }
  function morningSummary() {
    var n = state.nightQueue.length;
    if (!n) { toast('没有新消息', '这段时间附近没有新发布的', null); return; }
    var items = state.nightQueue.map(function (id) { return byId(id); }).filter(Boolean);
    var value = items.reduce(function (a, it) { return a + E.estValue(it); }, 0);
    items.sort(function (a, b) { return E.hotScore(b) - E.hotScore(a); });
    var top = items.slice(0, 3);
    toast('早间汇总', '新增 ' + n + ' 件，最抢手的三个：' + top.map(function (it) { return it.title; }).join('、') +
      '，合计约 ¥' + value, top[0]);
    state.nightQueue = [];
    saveJSON(LS.nightQ, []);
    $('#bellBadge').hidden = true;
    renderAlerts();
  }

  function renderMe() {
    var saved = claimedValue();
    var got = loadJSON(LS.badges, []);
    var u = state.auth.user;

    var html = '';
    html += '<div class="routebox"><div class="route-head"><span>账号</span></div>';
    if (u) {
      var acc = u.account;
      var masked = u.type === 'phone' ? acc.slice(0, 3) + '****' + acc.slice(-4)
        : acc.replace(/^(.{2}).*@/, '$1***@');
      html += '<div class="me-user"><div class="me-ava">' + esc(acc.slice(0, 1).toUpperCase()) + '</div>' +
        '<div><b>' + esc(masked) + '</b><span>' + (u.type === 'phone' ? '手机号登录' : '邮箱登录') +
        (state.subscribed ? ' · PRO 会员' : ' · 免费版') + '</span></div>' +
        '<button class="btn" data-logout="1" style="flex:0 0 auto;padding:6px 10px;font-size:12px">退出</button></div>';
    } else {
      html += '<p class="route-note">还没有登录。登录后收藏、领取记录和会员状态才能跟着账号走。</p>' +
        '<button class="btn primary" data-login="1" style="width:100%;margin-top:10px">登录 / 注册</button>';
    }
    html += '</div>';

    html += '<div class="routebox"><div class="route-head"><span>实名认证</span><b>' +
      (state.auth.kyc ? (state.auth.kyc.status === 'approved' ? '已认证' :
        state.auth.kyc.status === 'pending' ? '审核中' : '未通过') : '未认证') + '</b></div>' +
      '<p class="route-note">领取大件家具、婴儿用品时，认证过的账号更容易拿到对方的信任。</p>' +
      '<button class="btn" data-kyc="1" style="width:100%;margin-top:10px">' +
      (state.auth.kyc && state.auth.kyc.status === 'approved' ? '查看认证信息' : '去实名认证') + '</button></div>';

    html += '<div class="routebox"><div class="route-head"><span>我的战果</span><b>已省 ¥' + saved + '</b></div>' +
      '<div class="stats" style="grid-template-columns:repeat(3,1fr)">' +
      stat(state.claimed.length, '拿到手') + stat(state.favorites.length, '收藏') +
      stat(state.alerts.length, '收到提醒') + '</div>' +
      '<div class="badges">' + BADGES.map(function (b) {
        var on = got.indexOf(b.key) !== -1;
        return '<div class="badge-item' + (on ? ' on' : '') + '"><b>' + b.name + '</b><span>' +
          (on ? b.desc : '未解锁') + '</span></div>';
      }).join('') + '</div></div>';

    html += '<div class="routebox"><div class="route-head"><span>会员</span><b>' +
      (state.subscribed ? 'PRO 生效中' : '免费版') + '</b></div>' +
      '<p class="route-note">' + (state.subscribed ? '不限浏览、实时推送、抢手指数、顺路路线'
        : '每日可免费查看 ' + FREE_OPENS + ' 条详情，还剩 ' + Math.max(0, FREE_OPENS - state.freeOpens) + ' 条') + '</p>' +
      (state.subscribed ? '' : '<button class="btn primary" data-pay="month" style="width:100%;margin-top:10px">升级 PRO · ¥19/月</button>') +
      '</div>';

    html += '<div class="routebox"><div class="route-head"><span>发布与邀请</span></div>' +
      '<button class="btn primary" data-publish="1" style="width:100%;margin-bottom:8px">＋ 发布我的闲置（免费送）</button>' +
      '<button class="btn" data-invite="1" style="width:100%">邀请好友，得会员天数</button>' +
      '<p class="route-note">送出去帮到人，还能攒「热心值」；好友用你的邀请码注册或发布，你和好友都得更长的会员权益，越分享越划算。</p></div>';

    if (u) {
      html += '<div class="routebox"><div class="route-head"><span>我的发布</span><b id="myListCount">·</b></div>' +
        '<div id="myListings"><p class="route-note">加载中…</p></div></div>';

      html += '<div class="routebox"><div class="route-head"><span>账号管理</span></div>' +
        '<div class="legal-links"><a href="privacy.html" target="_blank">隐私政策</a>' +
        '<a href="agreement.html" target="_blank">用户协议</a></div>' +
        '<button class="btn danger" data-delaccount="1" style="width:100%;margin-top:10px">注销账号（删除我的数据）</button>' +
        '<p class="route-note">注销后账号将被删除，名下实名记录撤回、已发布闲置下架，操作不可恢复。</p></div>';
    }

    if (state.history.length) {
      html += '<div class="routebox"><div class="route-head"><span>最近看过</span><small>' +
        state.history.length + ' 件</small></div>' +
        state.history.slice(0, 6).map(function (id) {
          var it = byId(id);
          if (!it) return '';
          var c = catOf(it);
          return '<button class="hi" data-open="' + it.id + '">' +
            '<i style="background:' + c.tone + ';color:' + c.color + '">' + iconTag(it) + '</i>' +
            '<b>' + esc(it.title) + '</b><em>' + timeAgo(it.minutesAgo) + '</em></button>';
        }).join('') + '</div>';
    }

    html += '<div class="routebox"><div class="route-head"><span>偏好与体验</span></div>' +
      '<div class="swrow"><span>深色模式</span><button class="sw' + (state.darkMode ? ' on' : '') +
      '" data-toggle="dark"><i></i></button></div>' +
      '<div class="swrow"><span>大字号<i>给长辈或不方便看小字的时候用</i></span>' +
      '<button class="sw' + (state.largeFont ? ' on' : '') + '" data-toggle="font"><i></i></button></div>' +
      '<div class="sechead" style="padding:0;margin:10px 0 8px"><span>我感兴趣的品类</span>' +
      '<small>点一下切换，影响「为你推荐」</small></div>' +
      '<div class="ob-grid compact">' + Object.keys(CATEGORIES).map(function (k) {
        var on = state.prefs && state.prefs[k] > 0;
        return '<button class="obc' + (on ? ' on' : '') + '" data-pref="' + k + '">' +
          '<svg aria-hidden="true"><use href="#ic-' + k + '"></use></svg>' + CATEGORIES[k].label + '</button>';
      }).join('') + '</div>' +
      '<button class="btn" id="meReset" style="width:100%;margin-top:12px">重置演示数据</button>' +
      '<p style="font-size:11.5px;color:var(--ink-3);text-align:center;margin:10px 0 0">' +
      (Api.isOnline() === false ? '后端未启动，账号与支付走的是本地模拟' : '已连接本地后端 ' + Api.BASE) + '</p>' +
      '<a href="admin.html" target="_blank" class="btn" style="width:100%;margin-top:8px;display:block;text-align:center;text-decoration:none;line-height:1.4">打开数据后台</a>' +
      '</div>';

    $('#cardList').innerHTML = html;
    $('#cardList').hidden = false;
    $('#emptyState').hidden = true;
    $('#resultCount').textContent = '';
    if (u) loadMyListings();
  }
  function loadMyListings() {
    var box = document.getElementById('myListings');
    if (!box) return;
    Api.listingsMine().then(function (r) {
      if (!r.ok) { box.innerHTML = '<p class="route-note">离线模式暂不可用</p>'; return; }
      var ls = r.listings || [];
      var cnt = document.getElementById('myListCount');
      if (cnt) cnt.textContent = ls.length + ' 件';
      if (!ls.length) { box.innerHTML = '<p class="route-note">还没有发布过。点上面的「发布我的闲置」，把家里用不上的免费送出去吧。</p>'; return; }
      box.innerHTML = ls.map(function (l) {
        return '<div class="hi" data-mylist="' + l.id + '">' +
          '<i>' + (CATEGORIES[l.category] ? CATEGORIES[l.category].label : '其他') + '</i>' +
          '<b>' + esc(l.title) + '</b><em>' + (l.status === 'online' ? '在线' : '已下架') + ' · ' + timeAgo(Math.floor((Date.now() - l.createdAt) / 60000)) + '</em>' +
          '</div>';
      }).join('');
    }).catch(function () { if (box) box.innerHTML = '<p class="route-note">加载失败</p>'; });
  }
  function stat(n, label) {
    return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  /* ================= 引导 ================= */

  function openOnboard() {
    $('#obGrid').innerHTML = Object.keys(CATEGORIES).map(function (k) {
      return '<button class="obc" data-ob="' + k + '"><svg aria-hidden="true"><use href="#ic-' + k + '"></use></svg>' +
        CATEGORIES[k].label + '</button>';
    }).join('');
    $('#onboard').hidden = false;
  }
  function finishOnboard(prefs) {
    state.prefs = prefs || {};
    state.onboarded = true;
    saveJSON(LS.prefs, state.prefs);
    saveJSON(LS.onboarded, true);
    $('#onboard').hidden = true;
    renderMain();
  }

  /* ================= 付费墙 ================= */

  var pendingId = null;
  function tryOpenDetail(id) {
    if (state.subscribed) { openSheet(id); learn(id, 1); return; }
    if (state.freeOpens < FREE_OPENS) {
      state.freeOpens++;
      saveJSON(LS.opens, state.freeOpens);
      openSheet(id);
      learn(id, 1);
      return;
    }
    pendingId = id;
    $('#paywall').hidden = false;
  }
  function learn(id, w) {
    var it = byId(id);
    if (!it || !state.prefs) return;
    state.prefs[it.category] = (state.prefs[it.category] || 0) + w * 0.5;
    Object.keys(state.prefs).forEach(function (k) { state.prefs[k] *= 0.97; });
    saveJSON(LS.prefs, state.prefs);
  }

  /* ================= 提示条与推送 ================= */

  function toast(title, sub, item) {
    var el = document.createElement('div');
    el.className = 'toast';
    var cov = '';
    if (item) {
      var c = catOf(item);
      cov = '<div class="cov" style="background:' + c.tone + ';color:' + c.color + '">' + iconTag(item) + '</div>';
    }
    el.innerHTML = cov + '<div style="min-width:0"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>';
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 3600);
  }

  var timer = null;
  function setBell(on) {
    state.bellOn = on;
    saveJSON(LS.bell, on);
    trk('alert', { on: on });
    $('#bellBtn').classList.toggle('is-on', on);
    $('#bellBadge').hidden = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (on) {
      timer = setInterval(pushAlert, 9000);
      toast('已开启提醒', state.nightMode ? '夜间会自动静音，早上汇总给你' : '附近一有新货就通知你', null);
    }
  }
  function pushAlert() {
    var pool = ALL.filter(function (it) { return it.distanceKm <= 1.5; });
    if (!pool.length) pool = ALL;
    var it = pool[Math.floor(Math.random() * pool.length)];
    state.alerts.unshift({ id: it.id, at: Date.now() });
    state.alerts = state.alerts.slice(0, 30);
    saveJSON(LS.alerts, state.alerts);
    if (isQuietHour()) {
      state.nightQueue.push(it.id);
      state.nightQueue = state.nightQueue.slice(-20);
      saveJSON(LS.nightQ, []);
      state.nightQueue = state.nightQueue;
      saveJSON(LS.nightQ, state.nightQueue);
      return;
    }
    toast('新货 · ' + distText(it.distanceKm), it.title + ' · ' + E.remainingText(it), it);
    if (state.tab !== 'alerts') $('#bellBadge').hidden = false;
    if (state.tab === 'alerts') renderAlerts();
  }

  /* ================= 主渲染 ================= */

  function renderMain() {
    var isHome = state.tab === 'home';
    $('#searchInput').parentElement.parentElement.hidden = !isHome;
    $('#catChips').hidden = !isHome;
    document.querySelector('.subfilters').hidden = !isHome;
    $('#mapView').hidden = !(isHome && state.view === 'map');
    updateAiBar();
    if (isHome) {
      if (state.view === 'map') { $('#cardList').hidden = true; renderMap(); }
      else renderList();
    } else if (state.tab === 'saved') renderSaved();
    else if (state.tab === 'alerts') renderAlerts();
    else renderMe();
  }
  function updateAiBar() {
    if (state.tab !== 'home') { $('#aiBar').hidden = true; return; }
    var p = E.parseQuery(state.query, CITIES[state.cityKey].districts);
    var bits = [];
    if (p.label) bits.push(p.label);
    if (p.district) bits.push(p.district + '区');
    if (p.maxDist) bits.push('只看 1 公里内');
    if (p.freshOnly) bits.push('只看 3 小时内的新货');
    if (p.condNew) bits.push('只要几乎全新的');
    if (!bits.length) { $('#aiBar').hidden = true; return; }
    $('#aiBar').hidden = false;
    $('#aiBar').innerHTML = '<span class="ai-dot"></span>理解为「' + bits.join(' · ') + '」<button data-clearq="1">清除</button>';
  }
  function renderChips() {
    var keys = ['all'].concat(Object.keys(CATEGORIES));
    $('#catChips').innerHTML = keys.map(function (k) {
      return '<button class="chip' + (state.cat === k ? ' is-on' : '') + '" data-cat="' + k + '">' +
        (k === 'all' ? '全部' : CATEGORIES[k].label) + '</button>';
    }).join('');
  }

  /* ================= 事件 ================= */

  function toggleFav(id, ev) {
    ev.stopPropagation();
    var i = state.favorites.indexOf(id);
    if (i === -1) { state.favorites.push(id); learn(id, 2); trk('save', { act: 'add' }); }
    else { state.favorites.splice(i, 1); trk('save', { act: 'remove' }); }
    saveJSON(LS.fav, state.favorites);
    if (state.tab === 'saved') renderSaved(); else renderMain();
    if (!$('#sheet').hidden) openSheet(id);
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;

    var fav = t.closest('[data-fav]');
    if (fav) { toggleFav(fav.getAttribute('data-fav'), ev); return; }
    var open = t.closest('[data-open]');
    if (open) { tryOpenDetail(open.getAttribute('data-open')); return; }
    var msg = t.closest('[data-msg]');
    if (msg) { openMsg(msg.getAttribute('data-msg')); return; }
    var claimBtn = t.closest('[data-claim]');
    if (claimBtn) { claim(claimBtn.getAttribute('data-claim')); return; }
    var share = t.closest('[data-share]');
    if (share) {
      var si = byId(share.getAttribute('data-share'));
      if (si) { copyStr(shareText(si), '分享文案已复制'); trk('share', { cat: si.category }); }
      return;
    }
    if (t.closest('[data-copy]')) {
      var ta = $('#msgText');
      if (ta) copyStr(ta.value, '粘到聊天里就能发');
      return;
    }
    if (t.closest('[data-sent]')) {
      $('#msgSheet').hidden = true;
      toast('已发送', '对方会收到你的领取请求', null);
      return;
    }
    if (t.closest('[data-summary]')) { morningSummary(); return; }
    if (t.closest('[data-clearq]')) { state.query = ''; $('#searchInput').value = ''; renderMain(); return; }
    if (t.closest('[data-login]')) { openAuth(); return; }
    if (t.closest('[data-logout]')) {
      Api.logout();
      state.auth = { user: null, kyc: null };
      toast('已退出', '本地数据仍然保留', null);
      renderMain();
      return;
    }
    if (t.closest('[data-delaccount]')) {
      if (!window.confirm('确认注销账号？\n账号将被删除，名下实名记录撤回、已发布闲置下架，且不可恢复。')) return;
      Api.accountDelete().then(function (r) {
        if (r && r.ok) {
          Api.logout();
          state.auth = { user: null, kyc: null };
          toast('账号已注销', '你的数据已按要求删除', null);
          renderMain();
        } else {
          toast('注销失败', (r && r.msg) || '请稍后再试', 'bad');
        }
      }).catch(function () { toast('注销失败', '网络异常', 'bad'); });
      return;
    }
    if (t.closest('[data-kyc]')) { openKyc(); return; }
    if (t.closest('[data-publish]')) { if (window.SnagGrowth) window.SnagGrowth.openPublish(); return; }
    if (t.closest('[data-invite]')) { if (window.SnagGrowth) window.SnagGrowth.openInvite(); return; }
    var ml = t.closest('[data-mylist]');
    if (ml && window.SnagGrowth) { window.SnagGrowth.mylistTap(ml.getAttribute('data-mylist')); return; }
    var sh = t.closest('[data-share]');
    if (sh) { copyShare(sh.getAttribute('data-share')); return; }
    var po = t.closest('[data-poster]');
    if (po && window.SnagGrowth) { window.SnagGrowth.openPoster(po.getAttribute('data-poster')); return; }
    var rp = t.closest('[data-report]');
    if (rp && window.SnagGrowth) { window.SnagGrowth.openReport('item', rp.getAttribute('data-report')); return; }
    var payBtn = t.closest('[data-pay]');
    if (payBtn) { openPay(payBtn.getAttribute('data-pay') || 'month', 'wechat'); return; }
    var meth = t.closest('[data-method]');
    if (meth) {
      openPay(payOrder ? payOrder.plan : 'month', meth.getAttribute('data-method'));
      return;
    }
    var sceneBtn = t.closest('[data-scene]');
    if (sceneBtn) {
      var k = sceneBtn.getAttribute('data-scene');
      state.scene = state.scene === k ? null : k;
      if (state.scene) trk('scene', { scene: k });
      renderScenes(); renderMain();
      return;
    }
    if (t.closest('[data-closescene]')) { state.scene = null; renderScenes(); renderMain(); return; }
    var cityBtn = t.closest('[data-city]');
    if (cityBtn) {
      var ck = cityBtn.getAttribute('data-city');
      var c = CITIES[ck];
      state.region = {
        cityKey: ck, province: (R && R.provinceOf(c.provinceCode) || {}).name || '', county: null,
      };
      state.origin = null;
      saveJSON(LS.origin, null);
      loadCity(ck);
      $('#cityDrawer').hidden = true;
      renderChips(); renderStats(); renderMain();
      toast('已切换到' + c.name, itemsOf(ck).length + ' 件免费好物', null);
      Api.track('city_pick', { city: ck, county: '' });
      return;
    }
    if (t.closest('[data-clearloc]')) {
      state.origin = null;
      saveJSON(LS.origin, null);
      loadCity(state.cityKey);
      renderStats(); renderMain();
      toast('已清除定位', '距离改回按市中心计算', null);
      return;
    }

    var tg = t.closest('[data-toggle]');
    if (tg) {
      var kk = tg.getAttribute('data-toggle');
      if (kk === 'bell') setBell(!state.bellOn);
      else if (kk === 'night') { state.nightMode = !state.nightMode; saveJSON(LS.night, state.nightMode); trk('night_mode', { on: state.nightMode }); }
      else if (kk === 'font') {
        state.largeFont = !state.largeFont;
        saveJSON(LS.font, state.largeFont);
        document.documentElement.classList.toggle('lg', state.largeFont);
        trk('large_font', { on: state.largeFont });
      } else if (kk === 'dark') {
        state.darkMode = !state.darkMode;
        saveJSON(LS.theme, state.darkMode);
        document.documentElement.classList.toggle('dark', state.darkMode);
      }
      renderMain();
      return;
    }

    var pref = t.closest('[data-pref]');
    if (pref) {
      var pk = pref.getAttribute('data-pref');
      state.prefs = state.prefs || {};
      state.prefs[pk] = state.prefs[pk] > 0 ? 0 : 1;
      saveJSON(LS.prefs, state.prefs);
      renderMe();
      return;
    }

    var card = t.closest('.card');
    if (card && !t.closest('.lockmask')) { tryOpenDetail(card.getAttribute('data-id')); return; }
    if (card && t.closest('.lockmask')) { $('#paywall').hidden = false; return; }

    var pin = t.closest('.map-pin');
    if (pin) { state.selectedId = pin.getAttribute('data-id'); renderMap(); return; }

    var chip = t.closest('[data-cat]');
    if (chip) { state.cat = chip.getAttribute('data-cat'); trk('filter', { type: 'cat', v: state.cat }); renderChips(); renderMain(); return; }

    var vsw = t.closest('[data-view]');
    if (vsw) {
      state.view = vsw.getAttribute('data-view');
      each('.vsw', function (b) {
        var on = b === vsw;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderMain();
      return;
    }
    var tab = t.closest('[data-tab]');
    if (tab) {
      state.tab = tab.getAttribute('data-tab');
      each('.tab', function (b) { b.classList.toggle('is-on', b === tab); });
      if (state.tab === 'alerts') $('#bellBadge').hidden = true;
      renderMain();
      return;
    }
    var atab = t.closest('[data-atab]');
    if (atab) { setAuthType(atab.getAttribute('data-atab')); return; }

    if (t.id === 'meReset') {
      state.favorites = []; state.subscribed = false; state.freeOpens = 0;
      state.alerts = []; state.claimed = []; state.nightQueue = [];
      state.prefs = {}; state.onboarded = false; state.history = [];
      Object.keys(LS).forEach(function (k2) { try { localStorage.removeItem(LS[k2]); } catch (e) {} });
      try { localStorage.removeItem('snag.token'); localStorage.removeItem('snag.localdb'); } catch (e) {}
      Api.logout();
      state.auth = { user: null, kyc: null };
      if (timer) setBell(false);
      toast('已重置', '回到首次打开的状态', null);
      renderMain();
      openAuth();
      return;
    }
    if (t.id === 'scrim') { closeSheet(); return; }
  });

  $('#searchInput').addEventListener('input', function (e) {
    state.query = e.target.value;
    if (state.query.trim().length >= 2 && state.query.trim() !== state._lastSearchTracked) {
      state._lastSearchTracked = state.query.trim();
      trk('search', { q: state.query.trim() });
    }
    renderMain();
  });
  $('#radiusSel').addEventListener('change', function (e) { state.radius = parseFloat(e.target.value); trk('filter', { type: 'radius', v: state.radius }); renderMain(); });
  $('#timeSel').addEventListener('change', function (e) { state.maxMinutes = parseFloat(e.target.value); trk('filter', { type: 'time', v: state.maxMinutes }); renderMain(); });
  $('#sortSel').addEventListener('change', function (e) { state.sort = e.target.value; trk('filter', { type: 'sort', v: state.sort }); renderMain(); });
  $('#bellBtn').addEventListener('click', function () { setBell(!state.bellOn); });
  $('#locateBtn').addEventListener('click', locate);
  $('#placeBtn').addEventListener('click', openCityDrawer);
  $('#cityClose').addEventListener('click', function () { $('#cityDrawer').hidden = true; });
  $('#gpsBtn').addEventListener('click', function () { $('#cityDrawer').hidden = true; locate(); });
  $('#provSel').addEventListener('change', function () {
    fillCitySel(this.value, null);
    $('#cascadeGo').disabled = true;
  });
  $('#citySel').addEventListener('change', function () { fillCountySel(this.value, null); });
  $('#countySel').addEventListener('change', function () { $('#cascadeGo').disabled = !$('#citySel').value; });
  $('#cascadeGo').addEventListener('click', applyCascade);
  $('#pwClose').addEventListener('click', function () { $('#paywall').hidden = true; });
  $('#pwCta').addEventListener('click', function () {
    var plan = 'month';
    each('.plan', function (b) { if (b.classList.contains('is-on')) plan = b.getAttribute('data-plan'); });
    $('#paywall').hidden = true;
    openPay(plan, 'wechat');
  });
  $('#pwPlans').addEventListener('click', function (e) {
    var p = e.target.closest('[data-plan]');
    if (!p) return;
    each('.plan', function (b) { b.classList.toggle('is-on', b === p); });
    $('#pwCta').textContent = '去支付 · ' + (p.getAttribute('data-plan') === 'year' ? '¥118/年' : '¥19/月');
  });
  $('#authSend').addEventListener('click', sendCode);
  $('#authSubmit').addEventListener('click', submitAuth);
  $('#authSkip').addEventListener('click', function () {
    $('#authLayer').hidden = true;
    if (!state.onboarded) openOnboard();
  });
  $('#obDone').addEventListener('click', function () {
    var prefs = {};
    each('[data-ob].on', function (b) { prefs[b.getAttribute('data-ob')] = 1; });
    finishOnboard(prefs);
  });
  $('#obSkip').addEventListener('click', function () { finishOnboard({}); });
  document.addEventListener('click', function (e) {
    if (e.target.id === 'kycSubmit') submitKyc();
    if (e.target.id === 'payDone' && payOrder) {
      Api.payMock(payOrder.orderId).then(function (r) {
        if (r.ok) finishPay(); else toast('支付失败', r.msg || '', null);
      });
    }
  });

  /* ================= 启动 ================= */

  if (state.largeFont) document.documentElement.classList.add('lg');
  if (state.darkMode) document.documentElement.classList.add('dark');
  loadCity(state.cityKey, state.origin ? { lat: state.origin.lat, lon: state.origin.lon } : null);
  if (state.origin) { /* 已定位 */ } else { state.origin = null; }
  renderChips();
  renderScenes();
  renderStats();
  $('#bellBtn').classList.toggle('is-on', state.bellOn);
  if (state.bellOn) setBell(true);
  renderMain();

  // 没有令牌就立刻弹登录层，不等网络探测——避免等待时界面没反应
  if (!Api.getToken()) openAuth();

  Api.probe().then(function () {
    if (!Api.getToken()) return;
    Api.me().then(function (m) {
      if (m.ok && m.user) {
        state.auth.user = m.user;
        state.auth.kyc = m.kyc;
        if (m.user.subscribed) { state.subscribed = true; saveJSON(LS.sub, true); }
        if (m.user.inviteCode && !window.SNAG._invSynced) {
          // 把后端邀请码同步到本地，供邀请页使用
        }
        $('#authLayer').hidden = true;
        renderMain();
      } else {
        Api.logout();
        if ($('#authLayer').hidden) openAuth();
      }
    });
  });

  // 暴露给增长模块（growth.js）的最小状态与邀请码
  window.SNAG = window.SNAG || {};
  try {
    var _u = new URL(location.href);
    var _c = _u.searchParams.get('inv');
    if (_c) { _c = _c.toUpperCase(); try { localStorage.setItem('snag.invite', _c); } catch (e) {} }
    window.SNAG.inviteCode = localStorage.getItem('snag.invite') || null;
  } catch (e) { window.SNAG.inviteCode = null; }
  window.SNAG.cityKey = function () { return state.cityKey; };
  window.SNAG.region = function () { return state.region; };
  window.SNAG.refreshMe = function () { if (state.tab === 'me') renderMe(); };
  window.SNAG.openAuth = openAuth;
  window.SNAG.toast = toast;
  window.SNAG.byId = byId;
})();
