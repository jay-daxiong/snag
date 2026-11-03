/* Snag Postgres 真·持久化层（可选，由 DATABASE_URL 激活）
 *
 * 设计原则：业务代码完全不动（仍用内存 db + 同步 saveDB 写本地 JSON 做备份），
 * 本模块只负责把整个 db 对象作为 JSONB 快照存到一张表（snag_snapshot, id=1），
 * 使它成为跨重启 / 跨部署的"真相源"。
 *
 *  - 未设置 DATABASE_URL：本模块完全不启用，行为与原来一致（仅本地 JSON 文件）。
 *  - 设置了但连接失败 / pg 未装：自动回退到本地 JSON，并在日志报错，不影响启动。
 *  - 使用纯 JS 的 'pg' 驱动（无原生编译），可在免费托管平台正常安装运行。
 */
let pool = null;
let enabled = false;

function isCloud(u) {
  return /render\.com|supabase|neon\.tech|amazonaws|\.rds\.|postgres\.azure|crunchydata|fly\.dev/.test(u);
}

async function init() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    enabled = false;
    return false;
  }
  try {
    const { Pool } = require('pg');
    const ssl = isCloud(url) ? { rejectUnauthorized: false } : (process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false });
    pool = new Pool({ connectionString: url, ssl, max: 3, idleTimeoutMillis: 20000, connectionTimeoutMillis: 8000 });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS snag_snapshot (
         id INT PRIMARY KEY DEFAULT 1,
         data JSONB NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    enabled = true;
    console.log('[PG] 已连接 Postgres，持久化已启用');
    return true;
  } catch (e) {
    enabled = false;
    pool = null;
    console.error('[PG] 连接失败，回退到本地 JSON：' + e.message);
    return false;
  }
}

async function loadAll() {
  if (!pool) return null;
  try {
    const r = await pool.query('SELECT data FROM snag_snapshot WHERE id=1');
    if (r.rowCount === 0) return null;
    return r.rows[0].data;
  } catch (e) {
    console.error('[PG] loadAll 失败：' + e.message);
    return null;
  }
}

async function saveAll(obj) {
  if (!pool) return;
  try {
    const data = JSON.parse(JSON.stringify(obj));
    await pool.query(
      `INSERT INTO snag_snapshot (id, data, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [data]
    );
  } catch (e) {
    console.error('[PG] saveAll 失败：' + e.message);
  }
}

async function close() {
  if (pool) { try { await pool.end(); } catch (e) {} pool = null; }
}

module.exports = { init, loadAll, saveAll, close, isEnabled: () => enabled };
