// migrate-to-turso.js —— 把本机 data/app.db 的现有数据一次性搬到 Turso 云端库
// 用法（需先 npm install）：
//   TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=xxx node --experimental-sqlite migrate-to-turso.js
// 幂等：目标库会先清空三张表再写入，可重复执行。
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@libsql/client');
const path = require('path');

const URL = process.env.TURSO_URL;
const TOKEN = process.env.TURSO_TOKEN;
if (!URL) { console.error('请设置 TURSO_URL（和 TURSO_TOKEN）'); process.exit(1); }
const LOCAL = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'app.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS draws (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', anti_duplicate INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, draw_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', limit_count INTEGER NOT NULL DEFAULT -1, weight REAL NOT NULL DEFAULT 1, color TEXT DEFAULT '#22d3ee', remaining INTEGER NOT NULL DEFAULT -1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, draw_id TEXT NOT NULL, name TEXT NOT NULL, result_id TEXT, result_name TEXT, drawn_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_results_draw ON results(draw_id);
CREATE INDEX IF NOT EXISTS idx_part_draw ON participants(draw_id);
CREATE INDEX IF NOT EXISTS idx_part_name ON participants(draw_id, name);
`;

const TABLES = [
  ['draws', 'id,title,description,status,anti_duplicate,created_at'],
  ['results', 'id,draw_id,name,description,limit_count,weight,color,remaining,sort_order'],
  ['participants', 'id,draw_id,name,result_id,result_name,drawn_at']
];

(async () => {
  const src = new DatabaseSync(LOCAL);
  const dst = createClient({ url: URL, authToken: TOKEN || undefined });
  await dst.executeMultiple(SCHEMA);

  let total = 0;
  for (const [table, cols] of TABLES) {
    const rows = src.prepare(`SELECT ${cols} FROM ${table}`).all();
    const names = cols.split(',');
    await dst.execute(`DELETE FROM ${table}`);
    // 分批，避免单次请求过大
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const stmts = chunk.map(r => ({
        sql: `INSERT INTO ${table} (${cols}) VALUES (${names.map(() => '?').join(',')})`,
        args: names.map(n => (r[n] === undefined ? null : r[n]))
      }));
      await dst.batch(stmts, 'write');
    }
    total += rows.length;
    console.log(`  ${table}: ${rows.length} 行`);
  }
  console.log(`迁移完成，共 ${total} 行 → ${URL}`);
})().catch(e => { console.error('迁移失败:', e); process.exit(1); });
