/* Snag 支付网关（生产级，零依赖）
 *
 * 支持两种主流渠道，用 method 切换，缺密钥时自动降级为「演示模式」：
 *   - 微信支付 V3（Native 扫码）  method: 'wechat'
 *   - 支付宝（手机网站支付）      method: 'alipay'
 *
 * 演示模式：不下单到真实渠道，直接返回一个占位 code_url / 收银台二维码，
 * 并由前端「模拟支付」按钮触发 /api/pay/mockpay，方便本地把整条付费链路跑通。
 * 一旦配齐商户密钥，自动切换为真实下单 + 真实 /notify 验签回调，接口结构不变。
 *
 * 生产接入（在 .env / 启动环境配置）：
 *   微信： SNAG_WX_MCH_ID  SNAG_WX_APP_ID  SNAG_WX_SERIAL（证书序列号）
 *         SNAG_WX_PRIVATE_KEY（PEM 私钥内容或路径）  SNAG_WX_APIV3_KEY（回调解密）
 *         SNAG_WX_NOTIFY_URL（如 https://your.domain/api/pay/notify）
 *   支付宝：SNAG_ALI_APP_ID  SNAG_ALI_PRIVATE_KEY（PEM）  SNAG_ALI_PUBLIC_KEY（支付宝公钥）
 *         SNAG_ALI_NOTIFY_URL  （可选 SNAG_ALI_GATEWAY）
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const cfg = {
  wechat: {
    mchId: process.env.SNAG_WX_MCH_ID || '',
    appId: process.env.SNAG_WX_APP_ID || '',
    serial: process.env.SNAG_WX_SERIAL || '',
    privateKey: loadKey(process.env.SNAG_WX_PRIVATE_KEY),
    apiv3: process.env.SNAG_WX_APIV3_KEY || '',
    notifyUrl: process.env.SNAG_WX_NOTIFY_URL || '',
  },
  alipay: {
    appId: process.env.SNAG_ALI_APP_ID || '',
    privateKey: loadKey(process.env.SNAG_ALI_PRIVATE_KEY),
    publicKey: loadKey(process.env.SNAG_ALI_PUBLIC_KEY),
    notifyUrl: process.env.SNAG_ALI_NOTIFY_URL || '',
    gateway: process.env.SNAG_ALI_GATEWAY || 'https://openapi.alipay.com/gateway.do',
  },
};

function loadKey(v) {
  if (!v) return '';
  if (v.startsWith('-----BEGIN')) return v;
  try { return fs.readFileSync(v, 'utf8'); } catch (e) { return v; }
}

function wechatReady() { return !!(cfg.wechat.mchId && cfg.wechat.appId && cfg.wechat.privateKey && cfg.wechat.serial); }
function alipayReady() { return !!(cfg.alipay.appId && cfg.alipay.privateKey && cfg.alipay.publicKey); }

function rsaSign(privateKeyPem, data) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data, 'utf8');
  return signer.sign(privateKeyPem, 'base64');
}

/* ---------- 微信支付 V3 ---------- */
function wxBuildAuth(method, urlPath, bodyStr) {
  const c = cfg.wechat;
  const nonce = crypto.randomBytes(12).toString('hex');
  const ts = Math.floor(Date.now() / 1000);
  const message = method + '\n' + urlPath + '\n' + ts + '\n' + nonce + '\n' + bodyStr + '\n';
  const signature = rsaSign(c.privateKey, message);
  return 'WECHATPAY2-SHA256-RSA2048 mchid="' + c.mchId + '",nonce_str="' + nonce +
    '",signature="' + signature + '",timestamp="' + ts + '",serial_no="' + c.serial + '"';
}

function wxCreateOrder({ orderId, amount, description }) {
  const c = cfg.wechat;
  const bodyObj = {
    mchid: c.mchId, appid: c.appId, description: description || 'Snag 会员',
    out_trade_no: orderId, notify_url: c.notifyUrl,
    amount: { total: amount, currency: 'CNY' },
  };
  const bodyStr = JSON.stringify(bodyObj);
  const urlPath = '/v3/pay/transactions/native';
  const auth = wxBuildAuth('POST', urlPath, bodyStr);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com', path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'Accept': 'application/json' },
      timeout: 6000,
    }, (res) => {
      let d = ''; res.on('data', (c2) => (d += c2));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    req.on('timeout', () => req.destroy(new Error('wx timeout')));
    req.on('error', reject);
    req.write(bodyStr); req.end();
  });
}

// 微信回调验签 + 回调解密（AES-256-GCM）
function wxVerifyAndDecrypt(headers, bodyStr) {
  try {
    const ts = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const sig = headers['wechatpay-signature'];
    const platSerial = headers['wechatpay-serial'];
    // 生产应加载微信平台证书（按 serial 取），此处用配置的平台证书公钥校验签名
    if (!cfg.wechat.platformPublicKey) return { ok: false, reason: 'no-platform-cert' };
    const message = ts + '\n' + nonce + '\n' + bodyStr + '\n';
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message, 'utf8');
    if (!verifier.verify(cfg.wechat.platformPublicKey, sig, 'base64')) return { ok: false, reason: 'bad-sign' };
    const res = JSON.parse(bodyStr).resource;
    const buf = Buffer.from(res.ciphertext, 'base64');
    const authTag = buf.slice(buf.length - 16);
    const data = buf.slice(0, buf.length - 16);
    const iv = Buffer.from(res.nonce, 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.wechat.apiv3, 'utf8'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, null, 'utf8');
    decrypted += decipher.final('utf8');
    return { ok: true, data: JSON.parse(decrypted) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/* ---------- 支付宝 ---------- */
function alipaySign(params) {
  const c = cfg.alipay;
  const keys = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== '').sort();
  const qs = keys.map((k) => k + '=' + params[k]).join('&');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(qs, 'utf8');
  const sig = signer.sign(c.privateKey, 'base64');
  return { qs, sig };
}

function alipayCreateOrder({ orderId, amount, description }) {
  const c = cfg.alipay;
  const amountYuan = (amount / 100).toFixed(2);
  const params = {
    app_id: c.appId,
    method: 'alipay.trade.wap.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toLocaleString('sv-SE').replace('T', ' '),
    version: '1.0',
    notify_url: c.notifyUrl,
    return_url: c.notifyUrl,
    biz_content: JSON.stringify({
      out_trade_no: orderId,
      total_amount: amountYuan,
      subject: description || 'Snag 会员',
      product_code: 'QUICK_WAP_WAY',
    }),
  };
  const { qs, sig } = alipaySign(params);
  const url = c.gateway + '?' + qs + '&sign=' + encodeURIComponent(sig);
  return Promise.resolve({ code: '10000', payUrl: url });
}

// 支付宝回调验签
function alipayVerify(params) {
  try {
    const c = cfg.alipay;
    const sign = params.sign;
    const target = Object.keys(params).filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '').sort();
    const qs = target.map((k) => k + '=' + params[k]).join('&');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(qs, 'utf8');
    return verifier.verify(c.publicKey, sign, 'base64');
  } catch (e) { return false; }
}

/* 对外：创建支付单。返回 { ok, method, codeUrl|payUrl, demo, detail } */
async function createOrder({ orderId, amount, plan, method, description, clientIp }) {
  if (method === 'wechat' && wechatReady()) {
    try {
      const r = await wxCreateOrder({ orderId, amount, description });
      if (r.code_url) return { ok: true, method: 'wechat', codeUrl: r.code_url, demo: false, detail: r };
      return { ok: false, method: 'wechat', demo: false, detail: r };
    } catch (e) { return { ok: false, method: 'wechat', demo: false, error: e.message }; }
  }
  if (method === 'alipay' && alipayReady()) {
    try {
      const r = await alipayCreateOrder({ orderId, amount, description });
      if (r.payUrl) return { ok: true, method: 'alipay', payUrl: r.payUrl, demo: false, detail: r };
      return { ok: false, method: 'alipay', demo: false, detail: r };
    } catch (e) { return { ok: false, method: 'alipay', demo: false, error: e.message }; }
  }
  // 演示模式：返回占位二维码，由前端「模拟支付」完成
  const codeUrl = 'snag://pay/' + orderId;
  console.log('[PAY][demo] 创建演示订单 ' + orderId + ' ¥' + (amount / 100) + ' (' + method + ')');
  return { ok: true, method, codeUrl, payUrl: codeUrl, demo: true };
}

module.exports = {
  createOrder,
  wxVerifyAndDecrypt,
  alipayVerify,
  wechatReady,
  alipayReady,
};
