/* Snag AI 智能客服 · 前端浮窗
 * 用法：在 index.html 引入本脚本，初始化后自动挂载到 .phone 内。
 * 调用 Api.aiChat 走后端代理（默认本机 OFM 免费模型，离线自动降级规则问答）。
 */
(function () {
  'use strict';
  var GREET = '你好，我是 Snag 智能客服 🤖 关于找免费好物、发布闲置、会员和防骗，都可以问我～';
  var QUICK = ['怎么发布闲置？', '会员多少钱？', '怎么一键定位？', '遇到骗子怎么办？', '怎么邀请好友？'];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function init() {
    var phone = document.querySelector('.phone') || document.body;
    var fab = el('button', 'ai-fab', '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3a8 8 0 0 0-8 8v4a3 3 0 0 0 3 3h1v-7H6v-0a6 6 0 0 1 12 0v0h-2v7h1a3 3 0 0 0 3-3v-4a8 8 0 0 0-8-8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 18h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>');
    fab.setAttribute('aria-label', 'AI 智能客服');
    var panel = el('div', 'ai-panel', '');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="ai-head"><span>Snag 智能客服</span><button class="ai-close" aria-label="关闭">✕</button></div>' +
      '<div class="ai-msgs" id="aiMsgs"></div>' +
      '<div class="ai-quick" id="aiQuick"></div>' +
      '<div class="ai-input"><input id="aiInput" type="text" placeholder="输入你的问题…" autocomplete="off"><button id="aiSend">发送</button></div>';

    phone.appendChild(fab);
    phone.appendChild(panel);

    var msgs = panel.querySelector('#aiMsgs');
    var input = panel.querySelector('#aiInput');
    var quick = panel.querySelector('#aiQuick');
    var history = [];

    function addMsg(role, text) {
      var m = el('div', 'ai-msg ' + (role === 'user' ? 'me' : 'bot'));
      m.textContent = text;
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function addTyping() {
      var t = el('div', 'ai-msg bot typing', '<i></i><i></i><i></i>');
      msgs.appendChild(t);
      msgs.scrollTop = msgs.scrollHeight;
      return t;
    }

    function ask(text) {
      if (!text.trim()) return;
      addMsg('user', text);
      history.push({ role: 'user', content: text });
      var typing = addTyping();
      Api.aiChat(history.slice(-10)).then(function (r) {
        msgs.removeChild(typing);
        var ans = (r && r.text) || '抱歉，我暂时没法回答，换种说法试试？';
        addMsg('bot', ans);
        history.push({ role: 'assistant', content: ans });
        if (window.Api && Api.track) Api.track('ai_ask', { demo: !!(r && r.demo) });
      }).catch(function () {
        msgs.removeChild(typing);
        addMsg('bot', '网络开了小差，稍后再试～');
      });
    }

    QUICK.forEach(function (q) {
      var b = el('button', 'ai-chip', q);
      b.addEventListener('click', function () { ask(q); });
      quick.appendChild(b);
    });

    fab.addEventListener('click', function () {
      panel.hidden = false; fab.hidden = true;
      if (!msgs.childElementCount) { addMsg('bot', GREET); history.push({ role: 'assistant', content: GREET }); }
      input.focus();
    });
    panel.querySelector('.ai-close').addEventListener('click', function () { panel.hidden = true; fab.hidden = false; });
    panel.querySelector('#aiSend').addEventListener('click', function () { ask(input.value); input.value = ''; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { ask(input.value); input.value = ''; } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
