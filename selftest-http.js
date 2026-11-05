// selftest-http.js —— 不监听端口的 HTTP 层端到端回归
//
// 直接把伪 event 灌进 server.js 的 handle()，验证路由 / 鉴权 / 抽签 / 短链 / 静态页 / 备份恢复。
// 可在两种驱动下跑：
//   DB_DRIVER=cloudbase CLOUDBASE_MOCK=1 node selftest-http.js            # CloudBase 文档库（内存 Mock）
//   DATA_DIR=./.tools/st-http node --experimental-sqlite selftest-http.js  # 本地 SQLite
const assert = require('node:assert/strict');
// 同样含 importAll 覆盖风险；未显式指定时强制隔离目录，避免抹掉真实 data/app.db
if (!process.env.DATA_DIR && !process.env.TURSO_URL && process.env.DB_DRIVER !== 'cloudbase') {
  process.env.DATA_DIR = './.tools/selftest-http-db';
}
const { normalizeEvent, makeReq, makeRes } = require('./cloudbase/function/http-bridge');
const { handle } = require('./server');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Tdsw2008';

async function call(method, pathname, body, headers = {}) {
  const event = {
    httpMethod: method,
    path: pathname,
    headers,
    body: body == null ? '' : JSON.stringify(body)
  };
  const req = makeReq(normalizeEvent(event));
  const res = makeRes();
  await handle(req, res);
  const r = res.toResult();
  let json = null;
  try { json = JSON.parse(r.body); } catch (_) { /* 非 JSON */ }
  return { status: r.statusCode, headers: r.headers, body: r.body, json };
}

(async () => {
  console.log('HTTP 回归开始');

  // 1. 健康检查
  const h = await call('GET', '/api/health');
  assert.equal(h.status, 200, '健康检查');
  assert.equal(h.json.ok, true, 'health ok');
  console.log('  模式:', h.json.mode);

  // 2. 登录：错密码 / 正确密码
  assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401, '错密码应 401');
  const login = await call('POST', '/api/admin/login', { password: ADMIN_PASSWORD });
  assert.equal(login.status, 200, '正确密码应 200');
  assert.ok(login.json.token && login.json.token.includes('.'), 'HMAC token 格式');
  const auth = { 'x-admin-token': login.json.token };

  // 3. 鉴权：无 token / 伪造 token（验证 HMAC 自校验，不再依赖内存 Set）
  assert.equal((await call('GET', '/api/admin/draws')).status, 401, '无 token 应 401');
  assert.equal((await call('GET', '/api/admin/draws', null, { 'x-admin-token': login.json.token + 'x' })).status, 401, '伪造 token 应 401');
  assert.equal((await call('GET', '/api/admin/draws', null, auth)).status, 200, '合法 token 应 200');

  // 4. 创建抽签（限量 1 + 不限量）
  const created = await call('POST', '/api/admin/draws', {
    title: 'HTTP 自检', description: '回归测试', antiDuplicate: true,
    items: [
      { name: '唯一奖', limit: 1, weight: 1 },
      { name: '谢谢参与', limit: -1, weight: 1 }
    ]
  }, auth);
  assert.equal(created.status, 200, '创建应 200');
  const id = created.json.draw.id;
  assert.equal(created.json.draw.items.length, 2, '结果项数');

  // 5. 公开信息 / 抽签 / 防重复 / 空姓名
  const pub = await call('GET', `/api/draws/${id}`);
  assert.equal(pub.status, 200, '公开信息');
  assert.equal(pub.json.title, 'HTTP 自检');

  const d1 = await call('POST', `/api/draws/${id}/draw`, { name: '张三' });
  assert.equal(d1.status, 200, '抽签应 200');
  assert.equal(d1.json.ok, true, '首次抽签成功: ' + JSON.stringify(d1.json));
  const d2 = await call('POST', `/api/draws/${id}/draw`, { name: '张三' });
  assert.equal(d2.json.alreadyDrawn, true, '同名应回显已抽结果');
  assert.equal((await call('POST', `/api/draws/${id}/draw`, { name: '' })).json.error, 'name_required');

  // 6. 名单 / 统计
  const parts = await call('GET', `/api/admin/draws/${id}/participants`, null, auth);
  assert.equal(parts.json.participants.length, 1, '名单 1 条');
  const st = await call('GET', `/api/admin/draws/${id}/stats`, null, auth);
  assert.equal(st.json.total, 1, '统计 total');
  assert.equal(st.json.items.length, 2, '统计结果项数');

  // 7. CSV 导出（BOM + 表头）
  const csv = await call('GET', `/api/admin/draws/${id}/export`, null, auth);
  assert.equal(csv.status, 200, 'CSV 200');
  assert.ok(csv.body.startsWith('\ufeff姓名,抽签结果,抽签时间'), 'CSV BOM 与表头');
  assert.ok(csv.body.includes('张三'), 'CSV 含姓名');

  // 8. 短链 302
  const short = await call('GET', `/d/${id}`);
  assert.equal(short.status, 302, '短链 302');
  assert.equal(short.headers.Location, '/?d=' + encodeURIComponent(id), '短链跳转地址');

  // 9. 静态页（云函数包内也带 public/ 作为兜底）
  assert.equal((await call('GET', '/')).status, 200, '用户页');
  assert.equal((await call('GET', '/admin')).status, 200, '后台页');
  assert.equal((await call('GET', '/user.css')).status, 200, 'CSS');

  // 10. 备份 / 恢复 / 删除
  const backup = await call('GET', '/api/admin/backup', null, auth);
  assert.equal(backup.status, 200, '备份 200');
  assert.ok(backup.json.draws.some(d => d.id === id && d.participants.length === 1), '备份含名单');
  const restore = await call('POST', '/api/admin/restore', backup.json, auth);
  assert.equal(restore.json.ok, true, '恢复成功');
  assert.equal((await call('GET', `/api/admin/draws/${id}/participants`, null, auth)).json.participants.length, 1, '恢复后名单还在');

  assert.equal((await call('DELETE', `/api/admin/draws/${id}`, null, auth)).status, 200, '删除');
  assert.equal((await call('GET', `/api/draws/${id}`)).status, 404, '删除后 404');

  console.log('✅ HTTP 全部通过');
})().catch(e => { console.error('❌ 失败:', e); process.exit(1); });
