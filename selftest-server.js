// selftest-server.js —— 真实 HTTP 服务冒烟测试
// 验证 server.js 的 require.main === module 分支（本地 / 香港服务器 / Render 都走这条）。
// 用隔离端口与隔离数据目录，测完自动关闭子进程；不会碰 3000 常驻服务或 data/app.db。
//   node selftest-server.js
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PWD = 'selftest-only-password';

for (const d of ['.tools/smoke-local', '.tools/smoke-turso']) {
  fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}

async function waitHealth(base, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return await r.json();
    } catch (_) { /* 还没监听 */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('服务未在 ' + timeoutMs + 'ms 内就绪');
}

async function req(method, url, body, headers = {}, redirect) {
  const r = await fetch(url, {
    method, redirect,
    headers: Object.assign(body === undefined ? {} : { 'Content-Type': 'application/json' }, headers),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: r.status, data, headers: r.headers };
}

async function runMode(label, port, extraEnv) {
  const base = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env,
    PORT: String(port),
    ADMIN_PASSWORD: PWD,
    DATA_DIR: './.tools/smoke-local'
  };
  delete env.TURSO_URL;
  delete env.TURSO_TOKEN;
  delete env.DB_DRIVER;
  Object.assign(env, extraEnv);

  const child = spawn(process.execPath, ['--experimental-sqlite', 'server.js'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', c => { stderr += c.toString(); });

  try {
    const health = await waitHealth(base);
    assert.equal(health.ok, true, label + ': health.ok');
    assert.equal(health.mode, label === 'turso' ? 'turso' : 'local', label + ': health.mode');

    const bad = await req('POST', base + '/api/admin/login', { password: 'wrong' });
    assert.equal(bad.status, 401, label + ': 错误密码应 401');

    const login = await req('POST', base + '/api/admin/login', { password: PWD });
    assert.equal(login.status, 200, label + ': 正确密码应 200');
    assert.ok(login.data.token, label + ': 应返回 HMAC token');
    const H = { 'x-admin-token': login.data.token };

    const noAuth = await req('GET', base + '/api/admin/draws');
    assert.equal(noAuth.status, 401, label + ': 未授权应 401');

    const created = await req('POST', base + '/api/admin/draws', {
      title: '冒烟抽签', antiDuplicate: true,
      items: [{ name: 'A', limit: 1, weight: 1 }, { name: 'B', limit: 2, weight: 1 }]
    }, H);
    assert.equal(created.status, 200, label + ': 创建抽签');
    const id = created.data.draw.id;
    assert.ok(id, label + ': 应返回抽签 id');

    const pub = await req('GET', base + '/api/draws/' + encodeURIComponent(id));
    assert.equal(pub.status, 200, label + ': 公开信息');
    assert.equal(pub.data.title, '冒烟抽签', label + ': 标题');

    const d1 = await req('POST', base + '/api/draws/' + encodeURIComponent(id) + '/draw', { name: '张三' });
    assert.equal(d1.status, 200, label + ': 抽签请求');
    assert.ok(d1.data.result || d1.data.soldOut || d1.data.closed, label + ': 应有结果');

    const d2 = await req('POST', base + '/api/draws/' + encodeURIComponent(id) + '/draw', { name: '张三' });
    assert.equal(d2.data.alreadyDrawn, true, label + ': 同名防重复');

    const parts = await req('GET', base + '/api/admin/draws/' + encodeURIComponent(id) + '/participants', undefined, H);
    assert.equal(parts.data.participants.length, 1, label + ': 名单应为 1 人');
    const stats = await req('GET', base + '/api/admin/draws/' + encodeURIComponent(id) + '/stats', undefined, H);
    assert.equal(stats.status, 200, label + ': 统计');
    const csv = await req('GET', base + '/api/admin/draws/' + encodeURIComponent(id) + '/export', undefined, H);
    assert.ok(String(csv.data).includes(','), label + ': CSV 导出');

    // 新增：export-schedule 真实 HTTP 冒烟（成功 200 + 非法参数 400），local / turso 两种模式都跑
    const SCH = {
      title: '冒烟发言顺序', amStart: '08:40', amEnd: '12:00',
      pmStart: '14:00', pmEnd: '17:30', duration: 10, gap: 5,
      breakEnabled: true, breakEvery: 7, breakMinutes: 15, remark: '冒烟备注'
    };
    const schUrl = base + '/api/admin/draws/' + encodeURIComponent(id) + '/export-schedule';
    const sch = await req('POST', schUrl, SCH, H);
    assert.equal(sch.status, 200, label + ': export-schedule 200');
    assert.ok(String(sch.data).startsWith('<?xml'), label + ': export-schedule XML 头');
    assert.ok(String(sch.data).includes('08:40'), label + ': export-schedule 首位时间');
    const schBad = await req('POST', schUrl, Object.assign({}, SCH, { duration: 0 }), H);
    assert.equal(schBad.status, 400, label + ': export-schedule 非法参数 400');
    assert.equal(schBad.data.error, 'invalid_params', label + ': export-schedule invalid_params');

    const backup = await req('GET', base + '/api/admin/backup', undefined, H);
    assert.ok(Array.isArray(backup.data.draws), label + ': 完整备份');

    const home = await req('GET', base + '/');
    assert.equal(home.status, 200, label + ': 用户页');
    assert.ok(String(home.data).includes('galaxy'), label + ': 用户页含星系背景');
    const admin = await req('GET', base + '/admin');
    assert.equal(admin.status, 200, label + ': 后台页');
    assert.ok(String(admin.data).includes('admin'), label + ': 后台页内容');

    const short = await req('GET', base + '/d/' + encodeURIComponent(id), undefined, {}, 'manual');
    assert.equal(short.status, 302, label + ': 短链重定向');
    assert.equal(short.headers.get('location'), '/?d=' + encodeURIComponent(id), label + ': 短链目标');

    if (stderr.includes('[fatal]') || stderr.includes('[error]')) {
      throw new Error(label + ': 服务端出现错误日志\n' + stderr.slice(-800));
    }
    console.log('✅ ' + label + ' 真实 HTTP 全部通过（' + health.mode + '）');
  } finally {
    child.kill();
  }
}

(async () => {
  await runMode('local', 3107, {});
  await runMode('turso', 3108, { TURSO_URL: 'file:./.tools/smoke-turso/smoke.db' });
  console.log('✅ 真实服务冒烟完成');
})().catch(e => { console.error('❌ 冒烟失败:', e.message); process.exit(1); });
