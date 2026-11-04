// server.js —— Node 内置 http 服务：静态托管 + API 路由 + 管理员鉴权
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Tdsw2008';
const PUBLIC_DIR = path.join(__dirname, 'public');
const adminTokens = new Set();

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
          const token = crypto.randomBytes(24).toString('base64url');
          adminTokens.add(token);
          return send(res, 200, { ok: true, token });
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
      if (!adminTokens.has(token)) return send(res, 401, { ok: false, message: '未授权，请先登录' });

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
});

db.ready.then(() => {
  server.listen(PORT, () => {
    console.log(`抽签服务已启动: http://localhost:${PORT}  [${db.MODE}]`);
    console.log(`管理后台: http://localhost:${PORT}/admin  (密码由环境变量 ADMIN_PASSWORD 配置)`);
  });
}).catch(e => {
  console.error('[fatal] 数据库初始化失败：', e);
  process.exit(1);
});
