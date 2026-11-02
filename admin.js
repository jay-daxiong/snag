/* Snag 数据后台
 * 图表是自己画的 SVG，不依赖任何 CDN，断网也能渲染。
 */

(function () {
  'use strict';

  var BASE = location.protocol === 'file:'
    ? 'http://127.0.0.1:8787'
    : location.origin;

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function money(cents) { return '¥' + ((cents || 0) / 100).toFixed(2); }

  /* ---------- 管理员令牌（登录态） ---------- */
  var TOKEN_KEY = 'snag_admin_token';
  var MY_ROLE = '';
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  function authHeaders() { var t = getToken(); return t ? { 'Authorization': 'Bearer ' + t } : {}; }
  function needLogin() { setToken(''); MY_ROLE = ''; var m = document.getElementById('loginMask'); if (m) m.hidden = false; }

  // 按角色显示/隐藏后台面板：moderator 看不到 data-admin-only 的敏感面板
  function applyRoleVisibility() {
    var isAdmin = MY_ROLE === 'admin';
    document.querySelectorAll('[data-admin-only]').forEach(function (el) {
      el.style.display = isAdmin ? '' : 'none';
    });
    var badge = document.getElementById('roleBadge');
    if (badge) {
      if (MY_ROLE) {
        badge.hidden = false;
        badge.textContent = MY_ROLE === 'admin' ? '管理员' : '审核员';
        badge.className = 'role-badge ' + (isAdmin ? 'admin' : 'mod');
      } else {
        badge.hidden = true;
      }
    }
  }

  function rawFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, authHeaders(), opts.headers || {});
    return fetch(BASE + path, opts);
  }
  function get(path) {
    return rawFetch(path).then(function (r) {
      if (r.status === 401) { needLogin(); return Promise.reject(new Error('__auth__')); }
      if (r.status === 403) { return { ok: false, forbidden: true }; } // 角色不足，静默跳过
      return r.json();
    });
  }
  function post(path, body) {
    return rawFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      if (r.status === 401) { needLogin(); return Promise.reject(new Error('__auth__')); }
      return r.json();
    });
  }

  /* ---------- 自绘图表 ---------- */

  function lineChart(values, labels) {
    var W = 520, H = 190, PL = 34, PR = 10, PT = 14, PB = 26;
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length;
    var iw = W - PL - PR, ih = H - PT - PB;
    function X(i) { return PL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); }
    function Y(v) { return PT + ih - (v / max) * ih; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="新增用户趋势折线图">';
    for (var g = 0; g <= 3; g++) {
      var y = PT + (ih / 3) * g;
      s += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) +
        '" stroke="#24282A" stroke-width="1"/>';
      s += '<text x="' + (PL - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="#6F777B" font-size="10">' +
        Math.round(max - (max / 3) * g) + '</text>';
    }
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
    var area = d + ' L' + X(n - 1).toFixed(1) + ' ' + (PT + ih) + ' L' + PL + ' ' + (PT + ih) + ' Z';
    s += '<path d="' + area + '" fill="#0FA968" opacity="0.14"/>';
    s += '<path d="' + d + '" fill="none" stroke="#1FBE7A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    values.forEach(function (v, i) {
      s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6" fill="#1FBE7A"/>';
    });
    labels.forEach(function (l, i) {
      if (n > 8 && i % 2 === 1) return;
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#6F777B" font-size="10">' + esc(l) + '</text>';
    });
    return s + '</svg>';
  }

  function barChart(values, labels) {
    var W = 520, H = 190, PL = 40, PR = 10, PT = 14, PB = 26;
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length;
    var iw = W - PL - PR, ih = H - PT - PB;
    var bw = Math.min(26, (iw / n) * 0.62);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="每日收入柱状图">';
    for (var g = 0; g <= 3; g++) {
      var y = PT + (ih / 3) * g;
      s += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '" stroke="#24282A"/>';
      s += '<text x="' + (PL - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" fill="#6F777B" font-size="10">' +
        Math.round(max - (max / 3) * g) + '</text>';
    }
    values.forEach(function (v, i) {
      var cx = PL + (i + 0.5) * (iw / n);
      var h = Math.max(2, (v / max) * ih);
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (PT + ih - h).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="#0FA968"/>';
      if (v > 0) {
        s += '<text x="' + cx.toFixed(1) + '" y="' + (PT + ih - h - 4).toFixed(1) +
          '" text-anchor="middle" fill="#6F777B" font-size="9">' + v + '</text>';
      }
    });
    labels.forEach(function (l, i) {
      if (n > 8 && i % 2 === 1) return;
      var cx = PL + (i + 0.5) * (iw / n);
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#6F777B" font-size="10">' + esc(l) + '</text>';
    });
    return s + '</svg>';
  }

  function cityBars(map, cityNames) {
    var keys = Object.keys(map);
    var max = Math.max.apply(null, keys.map(function (k) { return map[k]; }).concat([1]));
    return keys.sort(function (a, b) { return map[b] - map[a]; }).map(function (k) {
      return '<div class="brow"><i>' + esc(cityNames[k] || k) + '</i>' +
        '<div class="bar"><i style="width:' + (map[k] / max * 100).toFixed(1) + '%"></i></div>' +
        '<b>' + map[k] + '</b></div>';
    }).join('');
  }

  var DEC_LABEL = { core: '核心 · 必须做', enhance: '增强 · 重点做', optional: '可选 · 可缓', gated: '门槛 · 按需做' };
  var DEC_CLS = { core: 'd-core', enhance: 'd-enhance', optional: 'd-optional', gated: 'd-gated' };

  function renderAnalytics(data) {
    if (!data || !data.ok) return;
    var s = data.summary || {};
    $('#decisionSummary').innerHTML =
      '<div class="ds-head">产品决策（人工 + 经验）</div>' +
      ['core', 'enhance', 'gated', 'optional'].map(function (k) {
        return '<div class="ds ' + DEC_CLS[k] + '"><b>' + (s[k] || 0) + '</b><span>' + DEC_LABEL[k] + '</span></div>';
      }).join('') +
      (data.dataSummary ? (
        '<div class="ds-head">数据自发归类（埋点算出来的，供复核）</div>' +
        ['core', 'enhance', 'gated', 'optional'].map(function (k) {
          return '<div class="ds ds-data ' + DEC_CLS[k] + '"><b>' + (data.dataSummary[k] || 0) + '</b><span>' + DEC_LABEL[k] + '</span></div>';
        }).join('')
      ) : '');

    var max = Math.max.apply(null, data.features.map(function (f) { return f.total; }).concat([1]));
    $('#featTable').innerHTML = data.features.map(function (f) {
      var alignCls = f.align === '一致' ? 'align-ok' : 'align-warn';
      return '<div class="frow">' +
        '<i class="fname">' + esc(f.label) + '</i>' +
        '<div class="fbar"><i class="' + DEC_CLS[f.decision] + '" style="width:' + (f.total / max * 100).toFixed(1) + '%"></i></div>' +
        '<b class="fcount">' + f.total + '</b>' +
        '<div class="fmeta">' +
          '<span class="fadopt">触达 ' + f.adoption + '%</span>' +
          '<span class="fscore">分 ' + f.score + '</span>' +
          '<span class="tag ' + DEC_CLS[f.decision] + '">' + DEC_LABEL[f.decision].split(' ')[0] + '</span>' +
          '<span class="tag tag-data ' + DEC_CLS[f.dataBucket] + '">数据:' + DEC_LABEL[f.dataBucket].split(' ')[0] + '</span>' +
          '<span class="align ' + alignCls + '">' + f.align + '</span>' +
          '<em class="fwhy" title="' + esc(f.why) + '">?</em>' +
        '</div>' +
        '</div>';
    }).join('');
    $('#featNote').textContent = data.generatedNote || '';

    $('#provBars').innerHTML = cityBars(data.byProvince, {});
  }

  /* ---------- 渲染 ---------- */

  function renderCards(c) {
    var items = [
      ['注册用户', c.users, '累计'],
      ['付费用户', c.paying, c.users ? '转化 ' + (c.paying / c.users * 100).toFixed(1) + '%' : '—'],
      ['月经常性收入', '¥' + c.mrr, '按年单折算到每月'],
      ['今日新增用户', c.todayUsers, '近 24 小时'],
      ['覆盖城市', c.cities, '全国 ' + (c.provinces || 0) + ' 省'],
      ['待审实名', c.kycPending, '需要人工处理'],
    ];
    $('#cards').innerHTML = items.map(function (it) {
      return '<div class="card"><span>' + it[0] + '</span><b>' + esc(it[1]) + '</b><em>' + it[2] + '</em></div>';
    }).join('');
  }

  function renderTables(orders, kyc, users) {
    $('#orderCount').textContent = orders.length + ' 条';
    $('#tblOrders').innerHTML =
      '<tr><th>订单号</th><th>套餐</th><th>渠道</th><th>金额</th><th>状态</th><th>创建</th><th>支付</th></tr>' +
      orders.slice(0, 14).map(function (o) {
        return '<tr><td>' + esc(o.orderId) + '</td><td>' + (o.plan === 'year' ? '年卡' : '月卡') + '</td>' +
          '<td>' + ({ wechat: '微信', alipay: '支付宝', card: '银行卡' })[o.method] + '</td>' +
          '<td>' + money(o.amount) + '</td>' +
          '<td><span class="tag ' + (o.status === 'paid' ? 'paid' : 'pendingpay') + '">' +
          (o.status === 'paid' ? '已支付' : '待支付') + '</span></td>' +
          '<td>' + fmtTime(o.createdAt) + '</td><td>' + fmtTime(o.paidAt) + '</td></tr>';
      }).join('');

    $('#kycCount').textContent = kyc.filter(function (k) { return k.status === 'pending'; }).length + ' 待审';
    $('#tblKyc').innerHTML =
      '<tr><th>ID</th><th>姓名</th><th>证件号</th><th>状态</th><th>提交时间</th><th>操作</th></tr>' +
      kyc.slice(0, 12).map(function (k) {
        return '<tr><td>' + esc(k.id) + '</td><td>' + esc(k.name) + '</td><td>' + esc(k.idNumber) + '</td>' +
          '<td><span class="tag ' + k.status + '">' +
          (k.status === 'approved' ? '已通过' : k.status === 'pending' ? '待审核' : '已驳回') + '</span></td>' +
          '<td>' + fmtTime(k.createdAt) + '</td>' +
          '<td>' + (k.status === 'pending'
            ? '<button class="mini ok" data-kyc="' + esc(k.id) + '" data-act="approve">通过</button>' +
              '<button class="mini no" data-kyc="' + esc(k.id) + '" data-act="reject">驳回</button>'
            : '—') + '</td></tr>';
      }).join('');

    $('#userCount').textContent = users.length + ' 条';
    $('#tblUsers').innerHTML =
      '<tr><th>ID</th><th>账号</th><th>方式</th><th>省/市</th><th>会员</th><th>状态</th><th>注册时间</th><th>操作</th></tr>' +
      users.slice(0, 14).map(function (u) {
        return '<tr><td>' + esc(u.id) + '</td><td>' + esc(u.account) + '</td>' +
          '<td>' + (u.type === 'phone' ? '手机' : '邮箱') + '</td>' +
          '<td>' + esc((u.province || '—') + '/' + (u.cityCode || '—')) + '</td>' +
          '<td>' + (u.subscribed ? '<span class="tag paid">PRO</span>' : '免费') + '</td>' +
          '<td>' + (u.disabled ? '<span class="tag pendingpay">已禁用</span>' : '<span class="tag paid">正常</span>') + '</td>' +
          '<td>' + fmtTime(u.createdAt) + '</td>' +
          '<td><button class="mini ' + (u.disabled ? '' : 'danger') + '" data-ban="' + esc(u.id) + '" data-act="' +
          (u.disabled ? 'unban' : 'ban') + '">' + (u.disabled ? '解封' : '封禁') + '</button></td></tr>';
      }).join('');
  }

  function renderReports(list) {
    $('#reportCount').textContent = (list.filter(function (r) { return r.status === 'pending'; }).length) + ' 待处理 / 共 ' + list.length + ' 条';
    if (!list.length) { $('#tblReports').innerHTML = '<tr><td colspan="7" class="none">还没有举报</td></tr>'; return; }
    $('#tblReports').innerHTML =
      '<tr><th>ID</th><th>对象</th><th>原因</th><th>举报人</th><th>状态</th><th>时间</th><th>操作</th></tr>' +
      list.slice(0, 30).map(function (r) {
        var obj = r.targetType === 'item'
          ? ('闲置《' + esc(r.targetTitle || '') + '》') + ' <small>(' + esc(r.targetId) + ')</small>'
          : ('用户 ' + esc(r.targetId));
        var actions = r.status === 'pending'
          ? '<button class="mini danger" data-takedown="' + esc(r.targetType) + '" data-id="' + esc(r.targetId) + '">' +
              (r.targetType === 'item' ? '下架' : '封禁') + '</button>' +
            '<button class="mini" data-resolve="' + esc(r.id) + '">标记处理</button>'
          : '—';
        return '<tr><td>' + esc(r.id) + '</td><td>' + obj + '</td>' +
          '<td>' + esc(r.reason) + '</td><td>' + esc(r.reporter) + '</td>' +
          '<td><span class="tag ' + (r.status === 'pending' ? 'pendingpay' : 'paid') + '">' +
          (r.status === 'pending' ? '待处理' : (r.status === 'resolved' || r.status === 'ignored' ? '已处理' : r.status)) + '</span></td>' +
          '<td>' + fmtTime(r.at) + '</td><td>' + actions + '</td></tr>';
      }).join('');
  }

  function renderSources(list) {
    $('#sources').innerHTML = list.map(function (s) {
      var cls = s.rate < 3 ? 'low' : s.rate < 8 ? 'mid' : 'high';
      return '<div class="srow"><b>' + esc(s.name) + '</b>' +
        '<span>今日 ' + s.total + ' 条 · 失败 ' + s.fail + '</span>' +
        '<span class="rate ' + cls + '">' + s.rate + '%</span>' +
        '<span>' + fmtTime(s.lastSync) + '</span></div>';
    }).join('');
  }

  function renderLogs(logs) {
    if (!logs.length) { $('#logs').innerHTML = '<div class="none">还没有事件</div>'; return; }
    $('#logs').innerHTML = logs.map(function (l) {
      return '<div class="log"><time>' + fmtTime(l.at) + '</time>' +
        '<span class="k">' + esc(l.kind) + '</span><span>' + esc(l.text) + '</span></div>';
    }).join('');
  }

  function renderModeration(m) {
    if (!m || !m.ok) return;
    var pending = m.pending || [], auto = m.autoReports || [];
    $('#modCount').textContent = pending.length + ' 待复核 / 机审命中 ' + auto.length + ' 条';
    if (!pending.length) { $('#tblMod').innerHTML = '<tr><td colspan="6" class="none">暂无待复核内容</td></tr>'; return; }
    $('#tblMod').innerHTML =
      '<tr><th>ID</th><th>标题</th><th>命中</th><th>发布者</th><th>提交</th><th>操作</th></tr>' +
      pending.map(function (l) {
        var hits = (l.hits || []).map(function (h) { return esc(h.word) + '(' + h.level + ')'; }).join('、') || '—';
        return '<tr><td>' + esc(l.id) + '</td><td>' + esc(l.title) + '</td><td>' + hits + '</td>' +
          '<td>' + esc(l.account) + '</td><td>' + fmtTime(l.createdAt) + '</td>' +
          '<td><button class="mini ok" data-approve="' + esc(l.id) + '">通过并上架</button>' +
          '<button class="mini danger" data-takedown="item" data-id="' + esc(l.id) + '">下架</button></td></tr>';
      }).join('');
  }

  function renderAudit(list) {
    if (!list || !list.ok) return;
    var rows = list.audit || [];
    if (!rows.length) { $('#tblAudit').innerHTML = '<tr><td colspan="5" class="none">暂无审计记录</td></tr>'; return; }
    $('#tblAudit').innerHTML =
      '<tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr>' +
      rows.map(function (a) {
        return '<tr><td>' + fmtTime(a.at) + '</td><td>' + esc(a.actor) + '</td>' +
          '<td><span class="tag paid">' + esc(a.action) + '</span></td>' +
          '<td>' + esc(a.target) + '</td><td>' + esc(a.detail) + '</td></tr>';
      }).join('');
  }

  /* ---------- 主流程 ---------- */

  var CITY_NAMES = {};
  function loadAll() {
    return Promise.all([
      get('/api/admin/overview'),
      get('/api/admin/orders'),
      get('/api/admin/kyc'),
      get('/api/admin/users'),
      get('/api/admin/sources'),
      get('/api/admin/logs'),
      get('/api/admin/analytics'),
      get('/api/admin/reports'),
      get('/api/admin/moderation'),
      get('/api/admin/audit'),
    ]).then(function (r) {
      var ov = r[0], orders = r[1].orders || [], kyc = r[2].list || [],
          users = r[3].users || [], src = r[4].sources || [], logs = r[5].logs || [],
          an = r[6] || {}, reps = r[7].reports || [], mod = r[8], audit = r[9];

      $('#conn').textContent = '已连接 ' + BASE;
      $('#conn').className = 'status ok';
      $('#banner').hidden = true;
      var lo = document.getElementById('logout'); if (lo) lo.hidden = false;
      applyRoleVisibility();

      renderCards(ov.cards);
      var labels = ov.byDay.map(function (d) { return d.date; });
      $('#chartUsers').innerHTML = lineChart(ov.byDay.map(function (d) { return d.users; }), labels);
      $('#chartRev').innerHTML = barChart(ov.byDay.map(function (d) { return Math.round(d.revenue); }), labels);
      $('#usersSum').textContent = '合计 ' + ov.byDay.reduce(function (a, d) { return a + d.users; }, 0) + ' 人';
      $('#revSum').textContent = '合计 ¥' + ov.byDay.reduce(function (a, d) { return a + d.revenue; }, 0).toFixed(0);
      $('#cityBars').innerHTML = cityBars(ov.cityCount, CITY_NAMES);
      renderSources(src);
      renderTables(orders, kyc, users);
      renderAnalytics(an);
      renderReports(reps);
      renderModeration(mod);
      renderAudit(audit);
      renderLogs(logs);
    });
  }

  function fail(e) {
    $('#conn').textContent = '后端未连接';
    $('#conn').className = 'status bad';
    $('#banner').hidden = false;
    $('#banner').textContent = '连不上 ' + BASE + '。请先在 snag 目录执行 node server.js，再打开这个页面。' +
      '（如果直接双击打开的本文件，浏览器会拦截跨源请求，也需要通过服务访问。）';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-kyc]');
    if (b) {
      post('/api/admin/kyc/review', { id: b.getAttribute('data-kyc'), action: b.getAttribute('data-act') })
        .then(loadAll);
    }
    var td = e.target.closest('[data-takedown]');
    if (td) {
      var reason = window.prompt('处理理由（将记录在后台日志）：', '违规内容');
      if (reason === null) return;
      post('/api/admin/takedown', { targetType: td.getAttribute('data-takedown'), targetId: td.getAttribute('data-id'), reason: reason })
        .then(loadAll);
    }
    var rs = e.target.closest('[data-resolve]');
    if (rs) {
      post('/api/admin/report/resolve', { id: rs.getAttribute('data-resolve'), action: 'resolve' })
        .then(loadAll);
    }
    var bn = e.target.closest('[data-ban]');
    if (bn) {
      post('/api/admin/user/ban', { userId: bn.getAttribute('data-ban'), action: bn.getAttribute('data-act') })
        .then(loadAll);
    }
    var ap = e.target.closest('[data-approve]');
    if (ap) {
      post('/api/admin/listing/approve', { id: ap.getAttribute('data-approve') })
        .then(loadAll);
    }
  });
  $('#refresh').addEventListener('click', loadAll);

  /* ---------- 登录 / 登出 ---------- */
  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = document.getElementById('loginUser').value.trim();
    var p = document.getElementById('loginPass').value;
    var errEl = document.getElementById('loginErr');
    errEl.hidden = true;
    fetch(BASE + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: u, pass: p }),
    }).then(function (r) {
      return r.json().then(function (j) { return { code: r.status, j: j }; });
    }).then(function (o) {
      if (o.code === 200 && o.j && o.j.ok) {
        setToken(o.j.token);
        MY_ROLE = o.j.role || 'admin';
        document.getElementById('loginMask').hidden = true;
        document.getElementById('loginPass').value = '';
        applyRoleVisibility();
        loadAll().catch(function (e) { if (e && e.message === '__auth__') return; fail(e); });
      } else {
        errEl.textContent = (o.j && o.j.msg) || '登录失败';
        errEl.hidden = false;
      }
    }).catch(function () {
      errEl.textContent = '登录失败，请确认后端 node server.js 已启动';
      errEl.hidden = false;
    });
  });

  document.getElementById('logout').addEventListener('click', function () {
    fetch(BASE + '/api/admin/logout', { method: 'POST', headers: authHeaders() })
      .catch(function () {})
      .then(function () { needLogin(); });
  });

  // 城市中文名：从前端 data.js 借一份
  try {
    var s = document.createElement('script');
    s.src = 'data.js';
    s.onload = function () {
      if (typeof CITIES !== 'undefined') {
        Object.keys(CITIES).forEach(function (k) { CITY_NAMES[k] = CITIES[k].name; });
        if (getToken()) loadAll().catch(function (e) { if (e && e.message === '__auth__') return; fail(e); });
      }
    };
    document.head.appendChild(s);
  } catch (e) {
    loadAll().catch(fail);
  }

  // 初始化：无令牌直接弹登录；有令牌则拉数据（若令牌失效会被网关 401 并回登录）
  if (!getToken()) {
    needLogin();
  } else {
    loadAll().catch(function (e) { if (e && e.message === '__auth__') return; fail(e); });
  }
  setInterval(function () { if (getToken()) loadAll().catch(function (e) { if (e && e.message === '__auth__') return; }); }, 15000);
})();
