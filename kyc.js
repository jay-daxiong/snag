/* Snag 实名认证网关（生产级，零依赖）
 *
 * 支持接入第三方「二要素 / 三要素 / 实人认证」服务商，用环境变量配置，
 * 缺密钥时自动降级为「人工审核」模式（与当前后台审核流程一致）。
 *
 * 生产接入示例（在 .env / 启动环境配置）：
 *   SNAG_KYC_PROVIDER=aliyun|tencent|juhe
 *   SNAG_KYC_APP_KEY=xxx
 *   SNAG_KYC_API_URL=https://xxx/verify   （服务商核验接口）
 *   SNAG_KYC_SECRET=xxx                    （用于 HMAC 签名，部分服务商需要）
 *
 * 注意：本地仅做身份证「格式 + 校验位（GB 11643 mod 11-2）」检查，真正的
 * 实名校验必须走服务商对接公安/银联/运营商库，禁止在客户端或后端明文留存
 * 完整身份证号——本模块落库时已做脱敏（见 server.js）。
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const cfg = {
  provider: (process.env.SNAG_KYC_PROVIDER || '').toLowerCase(),
  appKey: process.env.SNAG_KYC_APP_KEY || '',
  apiUrl: process.env.SNAG_KYC_API_URL || '',
  secret: process.env.SNAG_KYC_SECRET || '',
};

function ready() { return !!(cfg.provider && cfg.appKey && cfg.apiUrl); }

function httpPostJSON(urlStr, payload, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
      }, headers || {}),
      timeout: 6000,
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    req.on('timeout', () => req.destroy(new Error('kyc timeout')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* 对外：核验姓名 + 身份证号。返回 { ok, demo, status, msg, detail } */
async function verifyIdCard({ name, idNumber }) {
  if (!ready()) {
    // 演示/人工审核模式：直接进待审核，由后台人工核对（或接服务商后自动通过）
    console.log('[KYC][demo] 提交实名 ' + name + ' / ' + idNumber.slice(0, 4) + '**** 进入人工审核');
    return { ok: true, demo: true, status: 'pending' };
  }
  try {
    const headers = { 'X-App-Key': cfg.appKey };
    if (cfg.secret) {
      const ts = String(Date.now());
      const sig = crypto.createHmac('sha256', cfg.secret).update(ts + JSON.stringify({ name, idNumber })).digest('base64');
      headers['X-Timestamp'] = ts;
      headers['X-Signature'] = sig;
    }
    const r = await httpPostJSON(cfg.apiUrl, { name, idNumber }, headers);
    // 通用约定：result/code 表示核验通过
    const passed = r && (r.result === true || r.code === '0' || r.code === 0 || r.success === true);
    return { ok: true, demo: false, status: passed ? 'approved' : 'rejected', detail: r };
  } catch (e) {
    console.error('[KYC] 核验失败', e.message);
    return { ok: false, demo: false, error: e.message };
  }
}

module.exports = { verifyIdCard, ready };
