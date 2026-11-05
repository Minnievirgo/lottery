// db.js —— 双后端数据层
//   local : 默认，Node 内置 node:sqlite，零依赖，数据存本机 data/app.db
//   turso : 设置 TURSO_URL + TURSO_TOKEN 后启用，数据存云端 libSQL（永久免费 5GB），
//           服务重启/休眠/重新部署都不丢数据。SQL 方言与 SQLite 完全一致。
//
// 两种模式对外导出同一组 async 函数，server.js 无需关心底层。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TURSO_URL = process.env.TURSO_URL || '';
const TURSO_TOKEN = process.env.TURSO_TOKEN || '';
const MODE = TURSO_URL ? 'turso' : 'local';

let db = null;      // node:sqlite DatabaseSync（local）
let client = null;  // @libsql/client Client（turso）

const SCHEMA = `
CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  anti_duplicate INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  draw_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  limit_count INTEGER NOT NULL DEFAULT -1,
  weight REAL NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#22d3ee',
  remaining INTEGER NOT NULL DEFAULT -1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  draw_id TEXT NOT NULL,
  name TEXT NOT NULL,
  result_id TEXT,
  result_name TEXT,
  drawn_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_draw ON results(draw_id);
CREATE INDEX IF NOT EXISTS idx_part_draw ON participants(draw_id);
CREATE INDEX IF NOT EXISTS idx_part_name ON participants(draw_id, name);
`;

async function init() {
  if (MODE === 'turso') {
    // 延迟加载：本地模式不装依赖也能跑
    const { createClient } = require('@libsql/client');
    // 诊断日志：URL 非敏感，打印运行时真正收到的值，便于定位「面板填对了但进程拿到旧值」
    console.log('[db] 运行时 TURSO_URL =', JSON.stringify(TURSO_URL));
    client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined, intMode: 'number' });
    await client.executeMultiple(SCHEMA);
    console.log('[db] 模式: turso（云端持久库）', TURSO_URL.replace(/:\/\/.*@/, '://***@'));
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
    db.exec(SCHEMA);
    console.log('[db] 模式: local（本地 SQLite）', path.join(DATA_DIR, 'app.db'));
  }
}
const ready = init();

// ---- 统一底层：exec 参数是 libSQL 交互式事务对象（local 模式忽略）----
function rowsToObjects(rs) {
  const cols = rs.columns || [];
  return (rs.rows || []).map(r => {
    const o = {};
    cols.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}
function toArgs(params) {
  // libSQL 参数不接受 undefined，统一转 null
  return (params || []).map(v => (v === undefined ? null : v));
}

async function run(sql, params = [], exec) {
  await ready;
  if (MODE === 'local') return db.prepare(sql).run(...toArgs(params));
  const e = exec || client;
  return e.execute({ sql, args: toArgs(params) });
}
async function get(sql, params = [], exec) {
  await ready;
  if (MODE === 'local') return db.prepare(sql).get(...toArgs(params)) || null;
  const e = exec || client;
  const rs = await e.execute({ sql, args: toArgs(params) });
  return rowsToObjects(rs)[0] || null;
}
async function all(sql, params = [], exec) {
  await ready;
  if (MODE === 'local') return db.prepare(sql).all(...toArgs(params));
  const e = exec || client;
  const rs = await e.execute({ sql, args: toArgs(params) });
  return rowsToObjects(rs);
}

// 交互式事务：抽签的「查重 + 扣减 + 落库」必须原子
async function withTransaction(fn) {
  await ready;
  if (MODE === 'local') {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = await fn(null);
      db.exec('COMMIT');
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }
  }
  const tx = await client.transaction('write');
  try {
    const r = await fn(tx);
    await tx.commit();
    return r;
  } catch (e) {
    try { await tx.rollback(); } catch (_) {}
    throw e;
  }
}

function genId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---- 结果项写入 ----
async function insertItems(drawId, items, offset = 0) {
  const list = items || [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const limit = (it.limit == null || it.limit === '' || Number(it.limit) < 0) ? -1 : parseInt(it.limit, 10);
    const weight = parseFloat(it.weight) > 0 ? parseFloat(it.weight) : 1;
    const remaining = limit === -1 ? -1 : limit;
    await run(
      `INSERT INTO results (id,draw_id,name,description,limit_count,weight,color,remaining,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
      [genId(5), drawId, String(it.name), String(it.description || ''), limit, weight, String(it.color || '#22d3ee'), remaining, offset + i]
    );
  }
}

// ---- 抽签活动 ----
async function createDraw({ title, description = '', antiDuplicate = true, items = [] }) {
  const id = genId(6);
  const created = Date.now();
  await run(`INSERT INTO draws (id,title,description,status,anti_duplicate,created_at) VALUES (?,?,?,?,?,?)`,
    [id, String(title), String(description || ''), 'open', antiDuplicate ? 1 : 0, created]);
  await insertItems(id, items, 0);
  return getDrawRaw(id);
}

async function getDrawRaw(id) {
  const d = await get(`SELECT * FROM draws WHERE id=?`, [id]);
  if (!d) return null;
  const items = await all(`SELECT * FROM results WHERE draw_id=? ORDER BY sort_order`, [id]);
  return { ...d, items };
}

async function getDrawPublic(id) {
  const d = await get(`SELECT id,title,description,status,anti_duplicate FROM draws WHERE id=?`, [id]);
  if (!d) return null;
  return { id: d.id, title: d.title, description: d.description, status: d.status, antiDuplicate: !!d.anti_duplicate };
}

async function updateDraw(id, patch) {
  const cur = await getDrawRaw(id);
  if (!cur) return null;
  await run(`UPDATE draws SET title=?, description=?, status=?, anti_duplicate=? WHERE id=?`,
    [patch.title != null ? String(patch.title) : cur.title,
     patch.description != null ? String(patch.description) : cur.description,
     patch.status != null ? patch.status : cur.status,
     patch.antiDuplicate ? 1 : 0, id]);

  if (Array.isArray(patch.items)) {
    const existing = await all(`SELECT * FROM results WHERE draw_id=?`, [id]);
    const incomingIds = patch.items.map(i => i.id).filter(Boolean);
    for (const e of existing) {
      if (!incomingIds.includes(e.id)) await run(`DELETE FROM results WHERE id=?`, [e.id]);
    }
    for (let i = 0; i < patch.items.length; i++) {
      const it = patch.items[i];
      const limit = (it.limit == null || it.limit === '' || Number(it.limit) < 0) ? -1 : parseInt(it.limit, 10);
      const weight = parseFloat(it.weight) > 0 ? parseFloat(it.weight) : 1;
      if (it.id && existing.find(e => e.id === it.id)) {
        const usedRow = await get(`SELECT COUNT(*) c FROM participants WHERE draw_id=? AND result_id=?`, [id, it.id]);
        const used = Number(usedRow.c);
        const remaining = limit === -1 ? -1 : Math.max(0, limit - used);
        await run(`UPDATE results SET name=?,description=?,limit_count=?,weight=?,color=?,remaining=?,sort_order=? WHERE id=?`,
          [String(it.name), String(it.description || ''), limit, weight, String(it.color || '#22d3ee'), remaining, i, it.id]);
      } else {
        const remaining = limit === -1 ? -1 : limit;
        await run(`INSERT INTO results (id,draw_id,name,description,limit_count,weight,color,remaining,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
          [genId(5), id, String(it.name), String(it.description || ''), limit, weight, String(it.color || '#22d3ee'), remaining, i]);
      }
    }
  }
  return getDrawRaw(id);
}

async function deleteDraw(id) {
  await run(`DELETE FROM participants WHERE draw_id=?`, [id]);
  await run(`DELETE FROM results WHERE draw_id=?`, [id]);
  await run(`DELETE FROM draws WHERE id=?`, [id]);
}

async function listDraws() {
  const draws = await all(`SELECT * FROM draws ORDER BY created_at DESC`);
  const out = [];
  for (const d of draws) {
    const totalRow = await get(`SELECT COUNT(*) c FROM participants WHERE draw_id=?`, [d.id]);
    const items = await all(`SELECT id,name,limit_count,remaining,color FROM results WHERE draw_id=? ORDER BY sort_order`, [d.id]);
    out.push({ ...d, participantCount: Number(totalRow.c), items });
  }
  return out;
}

async function participants(drawId) {
  return all(`SELECT id,name,result_name AS resultName,drawn_at AS drawnAt FROM participants WHERE draw_id=? ORDER BY drawn_at DESC`, [drawId]);
}

// ---- 核心：执行抽签（事务）----
async function performDraw({ drawId, name }) {
  name = (name || '').trim();
  if (!name) return { error: 'name_required' };
  try {
    return await withTransaction(async (tx) => {
      const d = await get(`SELECT * FROM draws WHERE id=?`, [drawId], tx);
      if (!d) return { error: 'not_found' };
      if (d.status !== 'open') return { closed: true };

      if (d.anti_duplicate) {
        const ex = await get(`SELECT * FROM participants WHERE draw_id=? AND name=?`, [drawId, name], tx);
        if (ex) return { alreadyDrawn: true, result: { id: ex.result_id, name: ex.result_name } };
      }
      const avail = await all(`SELECT * FROM results WHERE draw_id=? AND (limit_count=-1 OR remaining>0) ORDER BY sort_order`, [drawId], tx);
      if (!avail.length) return { soldOut: true };

      const totalW = avail.reduce((s, r) => s + (r.weight || 1), 0);
      let r = Math.random() * totalW;
      let chosen = avail[0];
      for (const a of avail) {
        r -= (a.weight || 1);
        if (r <= 0) { chosen = a; break; }
      }
      if (chosen.limit_count !== -1) {
        await run(`UPDATE results SET remaining=remaining-1 WHERE id=?`, [chosen.id], tx);
      }
      await run(`INSERT INTO participants (id,draw_id,name,result_id,result_name,drawn_at) VALUES (?,?,?,?,?,?)`,
        [genId(6), drawId, name, chosen.id, chosen.name, Date.now()], tx);
      return { ok: true, result: { id: chosen.id, name: chosen.name, description: chosen.description, color: chosen.color } };
    });
  } catch (e) {
    return { error: 'db_error', message: e.message };
  }
}

// ---- 统计 ----
async function stats(drawId) {
  const d = await getDrawRaw(drawId);
  if (!d) return null;
  const parts = await participants(drawId);
  const byResult = {};
  parts.forEach(p => { byResult[p.resultName] = (byResult[p.resultName] || 0) + 1; });
  const items = d.items.map(it => ({
    id: it.id, name: it.name, color: it.color,
    limit: it.limit_count, remaining: it.remaining, count: byResult[it.name] || 0
  }));
  return { total: parts.length, items };
}

// ---- 导出 CSV（UTF-8 BOM，Excel 直接打开）----
function csvCell(s) {
  s = String(s == null ? '' : s);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
async function exportCSV(drawId) {
  const rows = await all(`SELECT name,result_name,drawn_at FROM participants WHERE draw_id=? ORDER BY drawn_at`, [drawId]);
  const lines = [['姓名', '抽签结果', '抽签时间'].join(',')];
  for (const r of rows) {
    const t = new Date(Number(r.drawn_at)).toLocaleString('zh-CN', { hour12: false });
    lines.push([csvCell(r.name), csvCell(r.result_name), csvCell(t)].join(','));
  }
  return '\ufeff' + lines.join('\r\n');
}

// ---- 完整备份 / 恢复（长期使用的保险，与底层无关）----
// 备份为一份 JSON：含全部抽签、结果项、参与名单，可用于换平台/兜底恢复。
async function exportAll() {
  const draws = await all(`SELECT * FROM draws ORDER BY created_at`);
  const out = [];
  for (const d of draws) {
    const items = await all(`SELECT * FROM results WHERE draw_id=? ORDER BY sort_order`, [d.id]);
    const parts = await all(`SELECT * FROM participants WHERE draw_id=? ORDER BY drawn_at`, [d.id]);
    out.push({ ...d, items, participants: parts });
  }
  return { version: 1, exportedAt: new Date().toISOString(), mode: MODE, draws: out };
}

async function importAll(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.draws)) throw new Error('备份文件格式不正确');
  return withTransaction(async (tx) => {
    await run(`DELETE FROM participants`, [], tx);
    await run(`DELETE FROM results`, [], tx);
    await run(`DELETE FROM draws`, [], tx);
    for (const d of data.draws) {
      await run(`INSERT INTO draws (id,title,description,status,anti_duplicate,created_at) VALUES (?,?,?,?,?,?)`,
        [d.id, String(d.title || ''), String(d.description || ''), d.status || 'open', d.anti_duplicate ? 1 : 0, Number(d.created_at) || Date.now()], tx);
      for (const it of (d.items || [])) {
        await run(`INSERT INTO results (id,draw_id,name,description,limit_count,weight,color,remaining,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
          [it.id, d.id, String(it.name), String(it.description || ''), Number(it.limit_count), Number(it.weight) || 1,
           it.color || '#22d3ee', Number(it.remaining), Number(it.sort_order) || 0], tx);
      }
      for (const p of (d.participants || [])) {
        await run(`INSERT INTO participants (id,draw_id,name,result_id,result_name,drawn_at) VALUES (?,?,?,?,?,?)`,
          [p.id, d.id, String(p.name), p.result_id || null, p.result_name || null, Number(p.drawn_at) || Date.now()], tx);
      }
    }
    return { ok: true, draws: data.draws.length };
  });
}

module.exports = {
  ready, MODE,
  createDraw, getDrawRaw, getDrawPublic, updateDraw, deleteDraw,
  listDraws, participants, performDraw, stats, exportCSV,
  exportAll, importAll
};
