/* Snag 增长模块：发布闲置 + 邀请裂变 + 分享海报 + 举报
 * 依赖：Api（api.js）、window.SNAG（app.js 暴露）、window.QR（qrcode.js）
 * 所有 UI 都挂在 .phone 内，符合移动端视觉。
 */
(function () {
  'use strict';
  var CATS = { furniture: '家具', appliance: '家电', digital: '数码', baby: '母婴', sport: '运动', book: '书籍', other: '其他' };
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h !== undefined) e.innerHTML = h; return e; }
  function phone() { return document.querySelector('.phone') || document.body; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }

  // 统一的遮罩层
  var scrim;
  function ensureScrim() {
    if (!scrim) { scrim = el('div', 'scrim', ''); scrim.hidden = true; phone().appendChild(scrim); }
    return scrim;
  }
  function showOverlay(node) { var s = ensureScrim(); s.hidden = false; node.hidden = false; }
  function hideOverlay(node) { node.hidden = true; if (scrim) scrim.hidden = true; }
  if (typeof document !== 'undefined') document.addEventListener('click', function (e) { if (e.target.classList && e.target.classList.contains('gr-scrim')) { var p = e.target.parentNode.querySelectorAll('.gr-sheet'); for (var i = 0; i < p.length; i++) p[i].remove(); e.target.remove(); } });

  function linkBase() {
    try { return location.origin + location.pathname; } catch (e) { return 'https://snag.app/'; }
  }
  function myInviteCode() {
    // 优先后端账户里的邀请码；本地模拟时退化为本地存储
    return (Api.getToken && window.SNAG && window.SNAG.inviteCode) ? window.SNAG.inviteCode : null;
  }

  /* ---------------- 发布闲置 ---------------- */
  function openPublish() {
    if (!Api.getToken()) { if (window.SNAG && window.SNAG.openAuth) window.SNAG.openAuth(); else alert('请先登录'); return; }
    var ov = el('div', 'gr-sheet', '');
    ov.innerHTML =
      '<div class="gr-head"><b>发布我的闲置（免费送）</b><button class="gr-x">✕</button></div>' +
      '<div class="gr-body">' +
      '<label class="gr-fld"><span>标题 *</span><input id="pubTitle" placeholder="例如：九成新婴儿床，孩子大了用不上"></label>' +
      '<div class="gr-label">分类</div><div class="gr-cats" id="pubCats">' +
      Object.keys(CATS).map(function (k, i) { return '<button class="gr-cat' + (i === 0 ? ' on' : '') + '" data-cat="' + k + '">' + CATS[k] + '</button>'; }).join('') + '</div>' +
      '<label class="gr-fld"><span>成色</span><select id="pubCond"><option>全新未拆</option><option selected>良好</option><option>一般</option><option>需搬运/大件</option></select></label>' +
      '<label class="gr-fld"><span>描述</span><textarea id="pubDesc" rows="3" placeholder="写写为什么送、怎么自提、成色细节"></textarea></label>' +
      '<label class="gr-fld"><span>自提地址</span><input id="pubAddr" placeholder="小区 / 街道（选填，默认用当前定位）"></label>' +
      '<p class="gr-tip">免费送出去既帮到人，又能攒「热心值」。发布后会出现在所在城市的免费好物里。</p>' +
      '<button class="gr-cta" id="pubSubmit">发布</button>' +
      '</div>';
    phone().appendChild(ov); showOverlay(ov);
    var cat = 'furniture';
    ov.querySelector('#pubCats').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]'); if (!b) return;
      cat = b.getAttribute('data-cat');
      ov.querySelectorAll('.gr-cat').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    ov.querySelector('.gr-x').addEventListener('click', function () { hideOverlay(ov); ov.remove(); });
    ov.querySelector('#pubSubmit').addEventListener('click', function () {
      var title = ov.querySelector('#pubTitle').value.trim();
      if (title.length < 2) { ov.querySelector('#pubTitle').focus(); return; }
      var region = window.SNAG && window.SNAG.region ? window.SNAG.region() : null;
      var district = (region && region.county) ? region.county : (region && region.city ? (region.city.name || '') : '');
      var cityCode = window.SNAG && window.SNAG.cityKey ? window.SNAG.cityKey() : null;
      Api.listingCreate({
        title: title, category: cat,
        desc: ov.querySelector('#pubDesc').value.trim(),
        condition: ov.querySelector('#pubCond').value,
        district: district, address: ov.querySelector('#pubAddr').value.trim(),
        cityCode: cityCode,
      }).then(function (r) {
        if (!r.ok) { alert(r.msg || '发布失败'); return; }
        hideOverlay(ov); ov.remove();
        if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已发布', '已经出现在同城免费好物里啦', null);
        if (window.SNAG && window.SNAG.refreshMe) window.SNAG.refreshMe();
        Api.track('listing_publish', { cat: cat });
      }).catch(function () { alert('网络异常，稍后再试'); });
    });
  }

  /* ---------------- 邀请裂变 ---------------- */
  function openInvite() {
    if (!Api.getToken()) { if (window.SNAG && window.SNAG.openAuth) window.SNAG.openAuth(); return; }
    Api.me().then(function (m) {
      var code = (m.ok && m.user && m.user.inviteCode) || myInviteCode() || '------';
      var reward = (m.ok && m.user) ? (m.user.rewardDays || 0) : 0;
      var invCount = (m.ok && m.user) ? (m.user.inviteCount || 0) : 0;
      var url = linkBase() + '?inv=' + code;
      var ov = el('div', 'gr-sheet', '');
      ov.innerHTML =
        '<div class="gr-head"><b>邀请好友，一起免费拿</b><button class="gr-x">✕</button></div>' +
        '<div class="gr-body">' +
        '<p class="gr-lead">好友用你的邀请码注册或发布闲置，你和好友都能获得会员权益。邀请越多，免费会员越久。</p>' +
        '<div class="gr-codebox"><div class="gr-code">' + esc(code) + '</div><span>你的专属邀请码</span></div>' +
        '<div class="gr-reward">已邀请 <b>' + invCount + '</b> 人 · 可用权益 <b>' + reward + '</b> 天' +
        '<div id="invTier" class="gr-tier"></div></div>' +
        '<button class="gr-cta" id="invShare">分享给好友</button>' +
        '<div class="gr-row"><button class="gr-btn" id="invCopy">复制邀请链接</button><button class="gr-btn" id="invPoster">生成分享海报</button></div>' +
        (reward >= 7 ? '<button class="gr-btn ghost" id="invRedeem">用 7 天权益兑换会员</button>' : '<p class="gr-tip">再邀请 1 位好友即可兑换 7 天会员</p>') +
        '</div>';
      phone().appendChild(ov); showOverlay(ov);
      ov.querySelector('.gr-x').addEventListener('click', function () { hideOverlay(ov); ov.remove(); });
      function doShare() {
        var text = '我在用 Snag 免费领好物，邀请你一起：' + url;
        if (navigator.share) { navigator.share({ title: 'Snag 免费好物', text: text, url: url }).catch(function () {}); }
        else { copyText(url); if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已复制', '邀请链接已复制，去微信粘贴给好友', null); }
      }
      ov.querySelector('#invShare').addEventListener('click', doShare);
      ov.querySelector('#invCopy').addEventListener('click', function () { copyText(url); if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已复制', '邀请链接已复制', null); });
      ov.querySelector('#invPoster').addEventListener('click', function () { openPoster(null, { type: 'invite', code: code, url: url }); });
      var rb = ov.querySelector('#invRedeem');
      if (rb) rb.addEventListener('click', function () {
        Api.inviteRedeem().then(function (r) { if (r.ok) { if (window.SNAG && window.SNAG.toast) window.SNAG.toast('兑换成功', '会员已开通', null); openInviteRefresh(ov); } else alert(r.msg || '兑换失败'); });
      });
      Api.inviteStatus().then(function (s) {
        if (s && s.ok) {
          var tierEl = ov.querySelector('#invTier');
          if (tierEl) {
            var html = '当前档位：<b>' + esc(s.tier) + '</b> · 每邀请 1 人得 <b>' + s.currentReward + '</b> 天';
            if (s.nextTier) html += '<br>再邀请 <b>' + s.toNext + '</b> 人升到「' + esc(s.nextTier) + '」，每单 +' + s.nextReward + ' 天';
            else html += '<br>已达最高档位，每邀请 1 人得 ' + s.currentReward + ' 天';
            tierEl.innerHTML = html;
          }
        }
      });
    });
  }
  function openInviteRefresh(ov) { var p = ov.parentNode; ov.remove(); openInvite(); }

  /* ---------------- 举报 ---------------- */
  function openReport(type, id) {
    var reasons = ['疑似诈骗（要求押金/运费/到付）', '虚假信息/已领走还挂着', '违规物品（危险品/违禁品）', '其他'];
    var ov = el('div', 'gr-sheet', '');
    ov.innerHTML =
      '<div class="gr-head"><b>举报</b><button class="gr-x">✕</button></div>' +
      '<div class="gr-body"><p class="gr-lead">请选择举报原因，我们核实后会下架并视情况封号。</p>' +
      '<div class="gr-reasons" id="rpReasons">' + reasons.map(function (r) { return '<button class="gr-reason" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
      '<button class="gr-cta" id="rpSubmit" disabled>提交举报</button></div>';
    phone().appendChild(ov); showOverlay(ov);
    var reason = '';
    ov.querySelector('#rpReasons').addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]'); if (!b) return;
      reason = b.getAttribute('data-r');
      ov.querySelectorAll('.gr-reason').forEach(function (x) { x.classList.toggle('on', x === b); });
      ov.querySelector('#rpSubmit').disabled = false;
    });
    ov.querySelector('.gr-x').addEventListener('click', function () { hideOverlay(ov); ov.remove(); });
    ov.querySelector('#rpSubmit').addEventListener('click', function () {
      if (!reason) return;
      Api.report(type, id, reason).then(function (r) {
        hideOverlay(ov); ov.remove();
        if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已收到举报', '感谢你的反馈，我们会尽快核实', null);
      }).catch(function () { alert('提交失败'); });
    });
  }

  /* ---------------- 分享海报 ---------------- */
  function openPoster(targetId, opts) {
    opts = opts || {};
    var title, sub, url, brand = 'SNAG 免费好物';
    if (opts.type === 'invite') { title = '送你一个免费领好物的入口'; sub = '扫码或用邀请码 ' + opts.code + ' 注册'; url = opts.url; }
    else {
      var it = window.SNAG && window.SNAG.byId ? window.SNAG.byId(targetId) : null;
      if (!it) { alert('物品不存在'); return; }
      title = it.title; sub = (it.district || '') + ' · 免费自取';
      url = linkBase() + '?inv=' + (myInviteCode() || '') + '&item=' + encodeURIComponent(it.id);
    }
    var ov = el('div', 'gr-poster', '');
    ov.innerHTML = '<div class="gr-poster-inner"><canvas id="posCanvas" width="320" height="460"></canvas>' +
      '<div class="gr-poster-btns"><button class="gr-btn" id="posSave">保存图片</button><button class="gr-btn" id="posCopy">复制链接</button><button class="gr-x2">关闭</button></div></div>';
    phone().appendChild(ov); showOverlay(ov);
    drawPoster(ov.querySelector('#posCanvas'), { brand: brand, title: title, sub: sub, url: url });
    ov.querySelector('#posSave').addEventListener('click', function () {
      try {
        var a = document.createElement('a'); a.download = 'snag-poster.png'; a.href = ov.querySelector('#posCanvas').toDataURL('image/png'); a.click();
        if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已保存', '去微信发朋友圈/群聊吧', null);
      } catch (e) { alert('当前环境不支持保存'); }
    });
    ov.querySelector('#posCopy').addEventListener('click', function () { copyText(url); if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已复制', '链接已复制', null); });
    ov.querySelector('.gr-x2').addEventListener('click', function () { hideOverlay(ov); ov.remove(); });
  }
  function drawPoster(canvas, data) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FF5A5F'); g.addColorStop(1, '#FF8E5F');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(data.brand, W / 2, 52);
    ctx.font = '15px sans-serif'; ctx.globalAlpha = 0.9;
    ctx.fillText('附近的免费好物，我们替你盯着', W / 2, 78); ctx.globalAlpha = 1;
    // 白卡
    ctx.fillStyle = '#fff'; roundRect(ctx, 24, 100, W - 48, 210, 16); ctx.fill();
    ctx.fillStyle = '#222'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'left';
    wrapText(ctx, data.title, 40, 140, W - 80, 26);
    ctx.fillStyle = '#888'; ctx.font = '14px sans-serif';
    ctx.fillText(data.sub, 40, 200);
    ctx.fillStyle = '#FF5A5F'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText('免费送 · 自提即可', 40, 232);
    // 二维码
    var qr = window.QR ? window.QR.generate(data.url) : null;
    var qx = W / 2 - 60, qy = 232, qsize = 120;
    if (qr) {
      var cell = qsize / qr.size;
      for (var r = 0; r < qr.size; r++) for (var c = 0; c < qr.size; c++) {
        ctx.fillStyle = qr.modules[r][c] ? '#111' : '#fff';
        ctx.fillRect(qx + c * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
      }
      ctx.strokeStyle = '#eee'; ctx.strokeRect(qx, qy, qsize, qsize);
      ctx.fillStyle = '#999'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('长按识别 / 扫码前往', W / 2, qy + qsize + 18);
    } else {
      ctx.fillStyle = '#fff'; ctx.fillRect(qx, qy, qsize, qsize);
      ctx.fillStyle = '#FF5A5F'; ctx.textAlign = 'center'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText('链接', W / 2, qy + 60);
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif'; ctx.globalAlpha = 0.85;
    ctx.fillText(data.url, W / 2, H - 18); ctx.globalAlpha = 1;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function wrapText(ctx, text, x, y, maxW, lh) {
    var chars = text.split(''); var line = ''; var yy = y;
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = chars[i]; yy += lh; }
      else line = test;
    }
    ctx.fillText(line, x, yy);
  }

  /* ---------------- 我的发布：下架 ---------------- */
  function mylistTap(id) {
    if (!confirm('下架这件闲置？下架后别人就看不到了。')) return;
    Api.listingDelete(id).then(function (r) {
      if (r.ok) { if (window.SNAG && window.SNAG.toast) window.SNAG.toast('已下架', '', null); if (window.SNAG && window.SNAG.refreshMe) window.SNAG.refreshMe(); }
      else alert(r.msg || '操作失败');
    }).catch(function () { alert('网络异常'); });
  }

  function copyText(t) {
    var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    if (navigator.clipboard) { try { navigator.clipboard.writeText(t); } catch (e) {} }
    ta.remove();
  }

  /* ---------------- 社交证明（首页激励） ---------------- */
  function refreshSocial() {
    var node = document.getElementById('socialProof'); if (!node) return;
    Api.social(window.SNAG && window.SNAG.cityKey ? window.SNAG.cityKey() : '').then(function (r) {
      if (!r.ok) return;
      node.innerHTML = '🎁 附近 <b>' + r.givingNearby + '+</b> 人正在免费送 · 本周已被领走 <b>' + r.claimedWeek + '+</b> 件';
    }).catch(function () {});
  }

  window.SnagGrowth = {
    openPublish: openPublish, openInvite: openInvite, openPoster: openPoster,
    openReport: openReport, mylistTap: mylistTap, refreshSocial: refreshSocial,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshSocial);
  else refreshSocial();
  setInterval(refreshSocial, 30000);
})();
