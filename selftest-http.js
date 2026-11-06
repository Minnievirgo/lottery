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
  return {
    status: r.statusCode, headers: r.headers, body: r.body, json,
    isBase64Encoded: r.isBase64Encoded
  };
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

  // 7b. 新增 POST /api/admin/draws/:id/export-schedule（AC-2.x / CloudBase base64 桥接）
  const SCH = {
    title: 'HTTP 发言顺序', amStart: '08:40', amEnd: '12:00',
    pmStart: '14:00', pmEnd: '17:30', duration: 10, gap: 5,
    breakEnabled: true, breakEvery: 7, breakMinutes: 15, remark: '备注冒烟'
  };
  const schPath = `/api/admin/draws/${id}/export-schedule`;
  const sch = await call('POST', schPath, SCH, auth);
  assert.equal(sch.status, 200, 'export-schedule 200');
  assert.equal(sch.headers['Content-Type'], 'application/vnd.ms-excel', 'MIME 严格不带 charset');
  assert.ok(sch.headers['Content-Disposition'].includes("filename*=UTF-8''"), 'RFC6266 双形式');
  const xml = sch.isBase64Encoded ? Buffer.from(sch.body, 'base64').toString('utf8') : sch.body;
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML 声明');
  assert.ok(xml.includes('<?mso-application progid="Excel.Sheet"?>'), 'ProgID 紧跟 XML 声明');
  assert.ok(xml.includes('08:40'), '首位开始时间单元格');
  assert.ok(xml.includes('张三'), '姓名单元格');
  assert.ok(xml.includes('ss:MergeAcross="6"'), '整行合并');
  if (process.env.DB_DRIVER === 'cloudbase') {
    // http-bridge.js:68-74 把 application/vnd.ms-excel 判为非文本 → base64，属正确行为
    assert.equal(sch.isBase64Encoded, true, 'CloudBase 桥接应走 base64');
    assert.ok(Buffer.from(sch.body, 'base64').toString('utf8').startsWith('<?xml'),
      'base64 解码后以 <?xml 开头');
  }

  const badSch = await call('POST', schPath, Object.assign({}, SCH, { duration: 0 }), auth);
  assert.equal(badSch.status, 400, 'duration=0 应 400');
  assert.equal(badSch.json.error, 'invalid_params', 'invalid_params');
  assert.ok(badSch.json.fields && badSch.json.fields.duration, '字段级中文提示');

  const over = await call('POST', schPath, Object.assign({}, SCH, {
    amEnd: '08:41', pmStart: '08:42', pmEnd: '08:43', duration: 600
  }), auth);
  assert.equal(over.status, 400, '超容量应 400 且不生成文件');
  assert.equal(over.json.error, 'capacity_exceeded', 'capacity_exceeded');
  assert.ok(Number.isInteger(over.json.capacity) && Number.isInteger(over.json.total) &&
    Number.isInteger(over.json.overflow), 'capacity/total/overflow 齐全');
  assert.ok(over.json.message.includes('最多可安排'), '中文容量提示');

  const emptyDraw = await call('POST', '/api/admin/draws',
    { title: '空名单自检', items: [{ name: 'X', limit: -1 }] }, auth);
  const noPart = await call('POST', `/api/admin/draws/${emptyDraw.json.draw.id}/export-schedule`, SCH, auth);
  assert.equal(noPart.status, 400, '空名单应 400');
  assert.equal(noPart.json.error, 'no_participants', 'no_participants');

  assert.equal((await call('POST', schPath, SCH, {})).status, 401, '新接口必须鉴权');
  assert.equal((await call('POST', '/api/admin/draws/NO_SUCH_ID/export-schedule', SCH, auth)).status, 404,
    '不存在的场次应 404');

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
