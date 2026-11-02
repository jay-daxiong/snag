/* Snag AI 智能客服（后端代理，零依赖）
 *
 * 设计要点：
 *  - 后端统一代理 LLM，API Key 与端点不暴露到前端（避免泄露 / 跨域）。
 *  - 兼容 OpenAI 协议：默认走本机 OFM 免费网关（http://127.0.0.1:18900/v1），
 *    生产用环境变量切到任意 OpenAI 兼容服务：
 *      SNAG_LLM_BASE=https://your.endpoint/v1
 *      SNAG_LLM_KEY=sk-xxx
 *      SNAG_LLM_MODEL=gpt-3.5-turbo（或你部署的模型名）
 *  - 离线 / 无密钥 / 调用失败时，自动降级为「规则问答引擎」，依旧能答常见疑问，
 *    保证客服入口永远有回应。
 */

const https = require('https');
const { URL } = require('url');

const BASE = process.env.SNAG_LLM_BASE || 'http://127.0.0.1:18900/v1';
const KEY = process.env.SNAG_LLM_KEY || 'free';
const MODEL = process.env.SNAG_LLM_MODEL || 'gpt-3.5-turbo';

const SYSTEM_PROMPT =
  '你是 Snag App 的智能客服助手。Snag 是一个「附近的免费好物」社区：用户可以在这里' +
  '免费领取别人闲置赠送的物品，也可以把自己用不上的东西免费送出去。' +
  '核心功能：一键定位（GPS 精准到市/县）、同城免费好物浏览、收藏、实时提醒、' +
  '发布闲置、邀请好友裂变得会员、会员订阅（月卡¥19/年卡¥118）、大件物品需实名认证。' +
  '请简洁、友好、口语化地回答用户问题，回答控制在 3 句话以内；涉及具体金额以页面为准。' +
  '如果用户问到敏感或无法确认的运营政策，引导其联系人工客服。';

function callLLM(messages) {
  return new Promise((resolve, reject) => {
    let base;
    try { base = new URL(BASE); } catch (e) { return reject(e); }
    const body = Buffer.from(JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }].concat(messages),
      temperature: 0.6,
      max_tokens: 300,
    }), 'utf8');
    const req = https.request({
      hostname: base.hostname, port: base.port || 443, path: base.pathname.replace(/\/$/, '') + '/chat/completions',
      method: 'POST', timeout: 12000,
      headers: {
        'Content-Type': 'application/json', 'Content-Length': body.length,
        'Authorization': 'Bearer ' + KEY,
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          resolve(text ? text.trim() : '');
        } catch (e) { reject(new Error('bad json')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('llm timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* ---------- 离线规则问答（兜底） ---------- */
const FAQ = [
  { k: ['怎么用', '如何使用', '怎么操作', '怎么领取', '怎么拿'], a: '打开 App 会自动定位到你附近，直接浏览或搜索「沙发 / 婴儿车」等关键词；看到喜欢的，点进详情发条消息约自提就行，全程免费。' },
  { k: ['发布', '送', '闲置', '上架', '怎么卖', '怎么送'], a: '点「我的 → 发布闲置」，填标题、分类、成色和自提地址，一键发布。免费送出去既能帮到人，还能攒「热心值」换会员。' },
  { k: ['定位', '位置', '在哪', '城市', '县'], a: '点右上角定位图标即可 GPS 精准到市/县；若关闭定位，可手动选省/市/区。全国 34 省 345 市都覆盖。' },
  { k: ['收费', '会员', '多少钱', '付费', '订阅', 'vip'], a: '浏览免费好物本身不收费；开通会员（月卡¥19、年卡¥118）可解锁不限次浏览、实时推送和抢手指数。邀请好友也能免费得会员天数。' },
  { k: ['支付', '付款', '微信', '支付宝', '买'], a: '会员支持微信支付和支付宝，下单后扫码即可。演示环境下用「模拟支付」完成流程，真实环境会走官方渠道并验签。' },
  { k: ['实名', '认证', '身份证', 'kyc'], a: '大件或高价值物品领取需要实名认证，填写姓名+身份证号（前端做校验位校验，后端对接认证服务并脱敏存储）。' },
  { k: ['邀请', '裂变', '拉新', '推荐', '好友'], a: '在「我的 → 邀请有礼」生成你的专属邀请码/海报，好友注册或发布即给你加会员天数或曝光加权。' },
  { k: ['安全', '骗子', '诈骗', '押金', '运费'], a: '免费的东西不该先掏钱。凡出现「押金 / 运费 / 到付 / 私下转账」都要警惕，可一键举报，我们核实后下架并封号。' },
  { k: ['提现', '赚钱', '收益'], a: 'Snag 主打「免费送与免费领」，暂不支持提现；你可以通过送闲置、邀请好友获得会员权益与社区曝光。' },
  { k: ['人工', '客服', '联系', '投诉'], a: '我是 AI 客服，能解答大部分问题；如需人工，可在「我的 → 关于」里提交反馈，工作日 24 小时内回复。' },
];

function ruleAnswer(text) {
  const t = (text || '').toLowerCase();
  for (const f of FAQ) if (f.k.some((k) => t.indexOf(k) >= 0)) return f.a;
  return null;
}

/* 对外：返回 { ok, text, demo } */
async function chat(messages) {
  const last = (messages[messages.length - 1] || {}).content || '';
  try {
    const text = await callLLM(messages);
    if (text) return { ok: true, text, demo: false };
    const r = ruleAnswer(last);
    return { ok: true, text: r || '这个问题我还在学习，你可以试试问我：怎么发布闲置、会员多少钱、怎么定位、遇到骗子怎么办。', demo: true };
  } catch (e) {
    const r = ruleAnswer(last);
    return { ok: true, text: r || '（AI 离线，已切换为智能问答）你可以问我：怎么发布闲置、会员收费、怎么定位、遇到骗子怎么办。', demo: true };
  }
}

module.exports = { chat };
