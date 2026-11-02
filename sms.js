/* Snag 短信网关（生产级，零依赖）
 *
 * 支持两家主流服务商，用环境变量切换，缺密钥时自动降级为「演示模式」：
 *   - 阿里云短信  (SNAG_SMS_PROVIDER=aliyun)  默认
 *   - 腾讯云短信  (SNAG_SMS_PROVIDER=tencent)
 *
 * 演示模式（没有配置 AccessKey / SecretId）不会真的发短信，只在服务端日志
 * 打印验证码，并返回 demo:true，前端据此把验证码直接显示出来，方便本地联调。
 *
 * 生产接入：在 .env / 启动环境里配好以下变量即可，接口结构无需改动。
 *   阿里云： SNAG_SMS_PROVIDER=aliyun
 *           SNAG_ALIYUN_AK_ID=xxx   SNAG_ALIYUN_AK_SECRET=xxx
 *           SNAG_ALIUN_SMS_SIGN=Snag  SNAG_ALIYUN_SMS_TPL= SMS_xxx（验证码模板）
 *   腾讯云： SNAG_SMS_PROVIDER=tencent
 *           SNAG_TENCENT_SMS_SECRET_ID=xxx  SNAG_TENCENT_SMS_SECRET_KEY=xxx
 *           SNAG_TENCENT_SMS_APPID=14xxxx  SNAG_TENCENT_SMS_SIGN=Snag
 *           SNAG_TENCENT_SMS_TPL=1xxxx（验证码模板 ID）
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const cfg = {
  provider: (process.env.SNAG_SMS_PROVIDER || 'aliyun').toLowerCase(),
  aliyun: {
    akId: process.env.SNAG_ALIYUN_AK_ID || '',
    akSecret: process.env.SNAG_ALIYUN_AK_SECRET || '',
    sign: process.env.SNAG_ALIYUN_SMS_SIGN || 'Snag',
    tpl: process.env.SNAG_ALIYUN_SMS_TPL || 'SMS_000000000',
    endpoint: 'dysmsapi.aliyuncs.com',
  },
  tencent: {
    secretId: process.env.SNAG_TENCENT_SMS_SECRET_ID || '',
    secretKey: process.env.SNAG_TENCENT_SMS_SECRET_KEY || '',
    appId: process.env.SNAG_TENCENT_SMS_APPID || '',
    sign: process.env.SNAG_TENCENT_SMS_SIGN || 'Snag',
    tpl: process.env.SNAG_TENCENT_SMS_TPL || '000000',
  },
};

function hasCred() {
  if (cfg.provider === 'tencent') return !!(cfg.tencent.secretId && cfg.tencent.secretKey);
  return !!(cfg.aliyun.akId && cfg.aliyun.akSecret);
}

function pctEnc(s) {
  // RFC 3986 编码（阿里云/腾讯云签名要求）
  return encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
}

function httpGetJSON(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      timeout: 6000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('sms timeout')); });
    req.on('error', reject);
  });
}

/* ---------- 阿里云短信（签名版本 1，HMAC-SHA1） ---------- */
function aliyunSend(phone, code) {
  const c = cfg.aliyun;
  const params = {
    AccessKeyId: c.akId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: c.sign,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: c.tpl,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };
  const keys = Object.keys(params).sort();
  const canonical = keys.map((k) => pctEnc(k) + '=' + pctEnc(params[k])).join('&');
  const stringToSign = 'GET&' + pctEnc('/') + '&' + pctEnc(canonical);
  const sig = crypto.createHmac('sha1', c.akSecret + '&').update(stringToSign).digest('base64');
  const query = canonical + '&Signature=' + pctEnc(sig);
  return httpGetJSON('https://' + c.endpoint + '/?' + query);
}

/* ---------- 腾讯云短信（TC3-HMAC-SHA256） ---------- */
function tencentSend(phone, code) {
  const c = cfg.tencent;
  const service = 'sms';
  const host = 'sms.tencentcloudapi.com';
  const action = 'SendSms';
  const version = '2021-01-11';
  const region = 'ap-guangzhou';
  const payload = JSON.stringify({
    PhoneNumberSet: ['+86' + phone],
    SmsSdkAppId: c.appId,
    SignName: c.sign,
    TemplateId: c.tpl,
    TemplateParamSet: [code],
  });
  const nowDate = new Date().toISOString().slice(0, 10);
  const hashedPayload = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const canonicalReq = ['POST', '/', '', 'content-type:application/json; charset=utf-8', 'host:' + host, '',
    'content-type;host', hashedPayload].join('\n');
  const scope = nowDate + '/' + service + '/tc3_request';
  const stringToSign = ['TC3-HMAC-SHA256', new Date().toISOString().slice(0, 19) + 'Z', scope,
    crypto.createHash('sha256').update(canonicalReq, 'utf8').digest('hex')].join('\n');
  function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }
  const secretDate = hmac('TC3' + c.secretKey, nowDate);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = 'TC3-HMAC-SHA256 Credential=' + c.secretId + '/' + scope +
    ', SignedHeaders=content-type;host, Signature=' + signature;
  return new Promise((resolve, reject) => {
    const body = Buffer.from(payload, 'utf8');
    const req = https.request({
      hostname: host, path: '/', method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Region': region,
        'X-TC-Timestamp': Math.floor(Date.now() / 1000),
        'Authorization': authorization,
      },
      timeout: 6000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    req.on('timeout', () => req.destroy(new Error('sms timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* 对外：发送验证码。返回 { ok, demo, msg } */
async function sendCode(type, account, code) {
  if (!hasCred()) {
    console.log('[SMS][demo] 向 ' + account + ' 发送验证码 ' + code + '（演示模式，未真正发送）');
    return { ok: true, demo: true };
  }
  try {
    const r = cfg.provider === 'tencent' ? await tencentSend(account, code) : await aliyunSend(account, code);
    const ok = cfg.provider === 'tencent'
      ? !!(r.Response && r.Response.SendStatusSet && r.Response.SendStatusSet[0] && r.Response.SendStatusSet[0].Code === 'Ok')
      : (r.Code === 'OK');
    return { ok, demo: false, provider: cfg.provider, detail: r };
  } catch (e) {
    console.error('[SMS] 发送失败', e.message);
    return { ok: false, demo: false, error: e.message };
  }
}

module.exports = { sendCode, hasCred, providerName: () => cfg.provider };
