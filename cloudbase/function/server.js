// server.js —— Node 内置 http 服务：静态托管 + API 路由 + 管理员鉴权
// 同一套 handle() 被两种入口复用：
//   1) 本地/服务器：本文件直接运行 → http.createServer(handle).listen(PORT)
//   2) CloudBase 云函数：cloudbase/function/index.js 把网关 event 转成伪 req/res 后调用 handle
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// DB_DRIVER=cloudbase 时切到 CloudBase 文档数据库；默认仍是本地 SQLite / Turso 双后端（零改动、零风险）。
const db = process.env.DB_DRIVER === 'cloudbase' ? require('./db-cloudbase') : require('./db');
// F1/F2 共用同一份排序纯函数；F2 排程与 XMLSS 生成均为零依赖纯函数
const resultSort = require('./public/lib/result-sort');
const schedule = require('./public/lib/schedule');
const spreadsheetml = require('./public/lib/spreadsheetml');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Tdsw2008';
const PUBLIC_DIR = path.join(__dirname, 'public');

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// ---- 管理员 token：HMAC 无状态签名 ----
// Serverless 云函数会冷启动、多实例并存，内存 Set 存不住登录态。
// 改成「时间戳 + HMAC(密码派生密钥)」自校验 token：任意实例都能验证，无需共享存储；
// 顺带让本地/服务器模式重启后登录态也不丢（7 天有效），改密码后旧 token 立即失效。
const TOKEN_TTL = 7 * 24 * 3600 * 1000;
function tokenSecret() { return crypto.createHash('sha256').update('lottery-admin:' + ADMIN_PASSWORD).digest(); }
function makeAdminToken() {
  const t = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', tokenSecret()).update(t).digest('base64url');
  return t + '.' + sig;
}
function validAdminToken(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const [t, sig] = tok.split('.');
  if (!t || !sig) return false;
  const ts = parseInt(t, 36);
  if (!Number.isFinite(ts) || ts > Date.now() + 60000 || Date.now() - ts > TOKEN_TTL) return false;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(t).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function send(res, status, obj, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
  res.end(JSON.stringify(obj));
}
function sendFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.ico': 'image/x-icon'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}
function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '') return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (pathname === '/admin') return sendFile(res, path.join(PUBLIC_DIR, 'admin.html'));
  const safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (filePath.startsWith(PUBLIC_DIR)) return sendFile(res, filePath);
  res.writeHead(403); res.end('Forbidden');
}

// 路由主体（导出给云函数入口复用）
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // ---------- 健康检查（Render 等平台探活）----------
    if (pathname === '/api/health') {
      return send(res, 200, { ok: true, mode: db.MODE, time: Date.now() });
    }

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      // 管理员登录
      if (pathname === '/api/admin/login' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        if (sha256(body.password || '') === sha256(ADMIN_PASSWORD)) {
          return send(res, 200, { ok: true, token: makeAdminToken() });
        }
        return send(res, 401, { ok: false, message: '密码错误' });
      }

      // 公开：抽签活动信息
      let m = pathname.match(/^\/api\/draws\/([^/]+)$/);
      if (m && method === 'GET') {
        const d = await db.getDrawPublic(m[1]);
        if (!d) return send(res, 404, { error: 'not_found' });
        return send(res, 200, d);
      }
      // 公开：执行抽签
      m = pathname.match(/^\/api\/draws\/([^/]+)\/draw$/);
      if (m && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const r = await db.performDraw({ drawId: m[1], name: body.name });
        return send(res, 200, r);
      }

      // 以下接口需要管理员鉴权
      const token = req.headers['x-admin-token'];
      if (!validAdminToken(token)) return send(res, 401, { ok: false, message: '未授权，请先登录' });

      // 列表
      if (pathname === '/api/admin/draws' && method === 'GET') {
        return send(res, 200, { draws: await db.listDraws() });
      }
      // 创建
      if (pathname === '/api/admin/draws' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        if (!body.title) return send(res, 400, { error: 'title_required' });
        const d = await db.createDraw({
          title: body.title, description: body.description,
          antiDuplicate: body.antiDuplicate !== false, items: body.items || []
        });
        return send(res, 200, { ok: true, draw: d });
      }
      // 完整备份（含全部抽签 + 结果项 + 参与名单）
      if (pathname === '/api/admin/backup' && method === 'GET') {
        const data = await db.exportAll();
        const fname = encodeURIComponent('抽签系统完整备份-' + new Date().toISOString().slice(0, 10) + '.json');
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fname}"`
        });
        return res.end(JSON.stringify(data, null, 2));
      }
      // 从备份恢复（会覆盖现有全部数据）
      if (pathname === '/api/admin/restore' && method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const r = await db.importAll(body);
        return send(res, 200, r);
      }
      // 更新
      m = pathname.match(/^\/api\/admin\/draws\/([^/]+)$/);
      if (m && method === 'PUT') {
        const body = await readBody(req).catch(() => ({}));
        const d = await db.updateDraw(m[1], body);
        if (!d) return send(res, 404, { error: 'not_found' });
        return send(res, 200, { ok: true, draw: d });
      }
      // 删除
      if (m && method === 'DELETE') {
        await db.deleteDraw(m[1]);
        return send(res, 200, { ok: true });
      }
      // 参与名单
      m = pathname.match(/^\/api\/admin\/draws\/([^/]+)\/participants$/);
      if (m && method === 'GET') {
        return send(res, 200, { participants: await db.participants(m[1]) });
      }
      // 统计
      m = pathname.match(/^\/api\/admin\/draws\/([^/]+)\/stats$/);
      if (m && method === 'GET') {
        const s = await db.stats(m[1]);
        if (!s) return send(res, 404, { error: 'not_found' });
        return send(res, 200, s);
      }
      // 导出 CSV
      m = pathname.match(/^\/api\/admin\/draws\/([^/]+)\/export$/);
      if (m && method === 'GET') {
        const csv = await db.exportCSV(m[1]);
        const d = await db.getDrawRaw(m[1]);
        const fname = encodeURIComponent((d ? d.title : 'draw') + '-名单.csv');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fname}"`
        });
        return res.end(csv);
      }
      // 导出发言顺序 .xls（Excel 2003 SpreadsheetML，服务端生成）
      // 放在 L113 validAdminToken 鉴权之后；GET /export 路由上方一行不改。
      m = pathname.match(/^\/api\/admin\/draws\/([^/]+)\/export-schedule$/);
      if (m && method === 'POST') {
        // 处理顺序：readBody → validateParams → getDrawRaw → participants → 排序 → 排程 → 容量 → XML
        const body = await readBody(req).catch(() => ({}));
        const checked = schedule.validateParams(body);
        if (!checked.ok) {
          return send(res, 400, {
            error: 'invalid_params',
            message: '时间参数或发言节奏设置不合法',
            fields: checked.fields
          });
        }
        const draw = await db.getDrawRaw(m[1]);
        if (!draw) return send(res, 404, { error: 'not_found' });
        const parts = await db.participants(m[1]);
        if (!parts.length) return send(res, 400, { error: 'no_participants', message: '暂无参与记录' });
        // participants() 返回 camelCase，必须显式传 accessor，与 CSV 的 snake_case 行区分
        const sorted = resultSort.sortRows(parts, p => p.resultName, p => p.drawnAt, p => p.id);
        const slots = schedule.computeSlots(sorted, checked.params);
        const plan = schedule.buildPlan(slots, checked.params);
        if (!plan.ok) {
          // 容量超限：不生成任何文件，返回结构化 400 让前端在 #schError 展示
          return send(res, 400, {
            error: plan.error,
            message: plan.message,
            capacity: plan.capacity,
            total: plan.total,
            overflow: plan.overflow,
            advice: plan.advice
          });
        }
        const xml = spreadsheetml.buildWorkbook(plan.rows, checked.params);
        // 严格 application/vnd.ms-excel（不加 charset）；CloudBase 桥接会据此走 base64，
        // 这是正确行为（http-bridge.js:68-74），不要改成 text/xml。
        res.writeHead(200, {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': spreadsheetml.contentDisposition(checked.params.title)
        });
        return res.end(xml);
      }
      return send(res, 404, { error: 'not_found' });
    }

    // ---------- 静态/短链 ----------
    const dm = pathname.match(/^\/d\/([^/]+)$/);
    if (dm) { res.writeHead(302, { 'Location': '/?d=' + encodeURIComponent(dm[1]) }); return res.end(); }
    serveStatic(res, pathname);
  } catch (e) {
    console.error('[error]', req.method, pathname, e);
    if (!res.headersSent) send(res, 500, { error: 'server_error', message: e.message });
    else res.end();
  }
}

module.exports = { handle };

// 仅在「直接运行本文件」时启动常驻 HTTP 服务；云函数入口只 require handle，不监听端口。
if (require.main === module) {
  db.ready.then(() => {
    // Render 等平台要求显式绑定 0.0.0.0；Node 默认绑 :: ，在其网络栈下会探测不到端口
    http.createServer(handle).listen(PORT, '0.0.0.0', () => {
      console.log(`抽签服务已启动: http://localhost:${PORT}  [${db.MODE}]`);
      console.log(`管理后台: http://localhost:${PORT}/admin  (密码由环境变量 ADMIN_PASSWORD 配置)`);
    });
  }).catch(e => {
    console.error('[fatal] 数据库初始化失败：', e);
    process.exit(1);
  });
}
