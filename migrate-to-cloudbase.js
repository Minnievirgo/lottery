// migrate-to-cloudbase.js —— 把现有「完整备份 JSON」导入 CloudBase 文档数据库
//
// 前提：已开通 CloudBase 免费环境、已创建三个集合、本机已具备云端凭证。
//   普通云函数/本地 CLI 部署场景下，凭证由 `tcb login` 或环境变量提供：
//     CLOUDBASE_ENV_ID=你的环境ID
//     CLOUDBASE_APIKEY=...（仅当本地直连需要时）
//     TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY（可选，SDK 自动读取）
//
// 用法：
//   node migrate-to-cloudbase.js 抽签系统完整备份-2026-11-05.json
//   FORCE=1 node migrate-to-cloudbase.js 备份.json     # 跳过交互确认
//
// ⚠️ 会覆盖目标库的全部数据（先清空三个集合再写入），谨慎操作。
const fs = require('fs');
const db = require('./db-cloudbase');

const file = process.argv[2];
if (!file) {
  console.error('用法: node migrate-to-cloudbase.js <备份JSON路径>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('文件不存在:', file);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!data || data.version !== 1 || !Array.isArray(data.draws)) {
  console.error('不是有效的抽签系统完整备份（version 1）');
  process.exit(1);
}
if (process.env.FORCE !== '1') {
  console.error('⚠️ 该操作会【覆盖目标库全部数据】。确认请设置 FORCE=1 后重跑。');
  process.exit(1);
}

const nDraws = data.draws.length;
const nItems = data.draws.reduce((s, d) => s + (d.items || []).length, 0);
const nParts = data.draws.reduce((s, d) => s + (d.participants || []).length, 0);
console.log(`准备导入：${nDraws} 个抽签 / ${nItems} 个结果项 / ${nParts} 条参与记录  来源模式: ${data.mode || '未知'}`);

db.ready.then(async () => {
  const r = await db.importAll(data);
  const after = await db.exportAll();
  console.log('导入完成:', r);
  console.log('校验：目标库现有', after.draws.length, '个抽签');
  if (after.draws.length !== nDraws) {
    console.error('❌ 数量不一致，请检查日志');
    process.exit(1);
  }
  console.log('✅ 数量一致，迁移成功');
}).catch(e => {
  console.error('❌ 迁移失败:', e);
  process.exit(1);
});
