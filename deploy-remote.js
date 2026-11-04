// deploy-remote.js —— 拿到凭证后的一键部署准备（只做确定可自动化的部分）
//
// 用法（凭证只通过环境变量传入，不写入任何文件、不打印到日志）：
//   TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=eyJ... \
//   GITHUB_USER=你的用户名 GITHUB_TOKEN=ghp_... \
//   node deploy-remote.js
//
// 可选：MIGRATE=1 会把本机 data/app.db 的数据一并搬到云端库（会覆盖云端同名表，谨慎）
// 可选：ADMIN_PASSWORD 指定部署时用的管理密码（默认沿用当前默认值）
//
// 完成后会输出：GitHub 仓库地址 + Render 需要填的 3 个环境变量值 + 手工步骤。
// Render 首次连接 GitHub 需要网页 OAuth 授权，无法用 API 代替，故最后一步需人工点一次。

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  TURSO_URL, TURSO_TOKEN, GITHUB_USER, GITHUB_TOKEN,
  ADMIN_PASSWORD, MIGRATE, RENDER_API_KEY, RENDER_OWNER_ID
} = process.env;

const REPO = 'lottery';
const mask = s => (s ? s.slice(0, 6) + '***' + s.slice(-4) : '(未设置)');
const log = (...a) => console.log(...a);

function need(name, val) {
  if (!val) { console.error(`❌ 缺少环境变量 ${name}`); process.exit(1); }
}

async function gh(pathname, opts = {}) {
  const r = await fetch('https://api.github.com' + pathname, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lottery-deploy',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  let body = null;
  try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

async function stepTurso() {
  need('TURSO_URL', TURSO_URL);
  need('TURSO_TOKEN', TURSO_TOKEN);
  const { createClient } = require('@libsql/client');
  const c = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  const r = await c.execute('SELECT 1 AS ok');
  if (Number(r.rows[0].ok) !== 1) throw new Error('Turso 返回异常');
  // 服务端首次启动会自建表；这里顺手确认可写
  await c.execute('CREATE TABLE IF NOT EXISTS _deploy_check (id INTEGER PRIMARY KEY)');
  await c.execute('DROP TABLE _deploy_check');
  log('✅ [1/4] Turso 云端库连通、可写：', mask(TURSO_URL));
}

async function stepRepo() {
  need('GITHUB_USER', GITHUB_USER);
  need('GITHUB_TOKEN', GITHUB_TOKEN);
  const who = await gh('/user');
  if (who.status !== 200) throw new Error(`GitHub 身份校验失败 (${who.status})：${who.body && who.body.message}`);
  log('✅ GitHub 身份：', who.body.login);

  const exists = await gh(`/repos/${GITHUB_USER}/${REPO}`);
  if (exists.status === 200) {
    log(`✅ [2/4] 仓库已存在：${exists.body.html_url}`);
  } else if (exists.status === 404) {
    const created = await gh('/user/repos', {
      method: 'POST',
      body: JSON.stringify({ name: REPO, private: false, auto_init: false, description: '抽签系统' })
    });
    if (created.status !== 201) throw new Error(`建仓库失败 (${created.status})：${JSON.stringify(created.body)}`);
    log('✅ [2/4] 仓库已创建：', created.body.html_url);
  } else {
    throw new Error(`查询仓库失败 (${exists.status})：${JSON.stringify(exists.body)}`);
  }
}

function stepPush() {
  const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
  const pushUrl = `https://x-access-token:${encodeURIComponent(GITHUB_TOKEN)}@github.com/${GITHUB_USER}/${REPO}.git`;
  try {
    // token 只存在于本次命令参数，不写入 .git/config
    execFileSync('git', ['push', '-f', pushUrl, `HEAD:refs/heads/main`], { cwd: __dirname, stdio: 'pipe' });
  } catch (e) {
    throw new Error('git push 失败：' + (e.stderr ? e.stderr.toString() : e.message));
  }
  // 设置干净的 remote（不含 token），方便以后正常推送
  const clean = `https://github.com/${GITHUB_USER}/${REPO}.git`;
  try { execFileSync('git', ['remote', 'add', 'origin', clean], { cwd: __dirname, stdio: 'pipe' }); }
  catch (_) { execFileSync('git', ['remote', 'set-url', 'origin', clean], { cwd: __dirname, stdio: 'pipe' }); }
  execFileSync('git', ['fetch', 'origin', 'main'], { cwd: __dirname, stdio: 'pipe' });
  try { execFileSync('git', ['branch', '--set-upstream-to=origin/main', branch], { cwd: __dirname, stdio: 'pipe' }); } catch (_) {}
  log(`✅ [3/4] 代码已推送到 main（本地分支 ${branch}），remote 已设为不含凭证的地址`);
}

function stepMigrate() {
  if (MIGRATE !== '1') { log('⏭️ [4/4] 未请求数据迁移（如需把现有抽签搬上云，加 MIGRATE=1 重跑）'); return; }
  const env = { ...process.env, TURSO_URL, TURSO_TOKEN };
  execFileSync(process.execPath, ['--experimental-sqlite', path.join(__dirname, 'migrate-to-turso.js')],
    { cwd: __dirname, env, stdio: 'inherit' });
  log('✅ [4/4] 本地数据已迁移到云端库');
}

async function tryRender() {
  if (!RENDER_API_KEY || !RENDER_OWNER_ID) return false;
  const envVars = [
    { key: 'ADMIN_PASSWORD', value: ADMIN_PASSWORD || 'Tdsw2008' },
    { key: 'TURSO_URL', value: TURSO_URL },
    { key: 'TURSO_TOKEN', value: TURSO_TOKEN }
  ];
  const payload = {
    type: 'web_service', name: REPO, ownerId: RENDER_OWNER_ID,
    repo: `https://github.com/${GITHUB_USER}/${REPO}`, branch: 'main',
    autoDeployTrigger: 'commit',
    serviceDetails: {
      runtime: 'docker', plan: 'free', dockerfilePath: './Dockerfile',
      healthCheckPath: '/api/health', envVars
    }
  };
  const r = await fetch('https://api.render.com/v1/services', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${RENDER_API_KEY}` },
    body: JSON.stringify(payload)
  });
  const txt = await r.text();
  if (r.ok) { log('✅ Render 服务已通过 API 创建：', JSON.parse(txt).service && JSON.parse(txt).service.dashboardUrl); return true; }
  log('⚠️ Render API 未成功（可能需要先在控制台绑定付款方式 / 连接 GitHub）：', r.status, txt.slice(0, 400));
  return false;
}

(async () => {
  log('=== 抽签系统 · 远程部署准备 ===');
  await stepTurso();
  await stepRepo();
  stepPush();
  stepMigrate();
  const auto = await tryRender();

  log('\n=== 交付信息（请保存）===');
  log('GitHub 仓库 :', `https://github.com/${GITHUB_USER}/${REPO}`);
  log('TURSO_URL   :', TURSO_URL);
  log('TURSO_TOKEN :', `已设置（长度 ${TURSO_TOKEN.length}，完整值请自行粘贴到 Render 面板）`);
  log('ADMIN_PASSWORD:', ADMIN_PASSWORD || 'Tdsw2008', '(建议改成你自己的)');
  if (!auto) {
    log('\n=== Render 最后一步（需你在网页点一次，约 1 分钟）===');
    log('1. 打开 https://dashboard.render.com → New → Blueprint');
    log('2. 连接 GitHub 账号（首次需 OAuth 授权），选择仓库 ' + REPO);
    log('3. Apply 后填 3 个环境变量：TURSO_URL / TURSO_TOKEN / ADMIN_PASSWORD');
    log('4. 部署完成打开 https://<服务名>.onrender.com/api/health ，应返回 {"ok":true,"mode":"turso"}');
  }
  log('\n⚠️ 用完请在 GitHub / Turso 控制台撤销本次使用的 Token。');
})().catch(e => { console.error('❌ 部署准备失败:', e.message); process.exit(1); });
