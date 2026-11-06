// db-cloudbase.js —— 腾讯云开发 CloudBase「文档型数据库」数据层
//
// 与 db.js 导出完全相同的接口，server.js 通过 DB_DRIVER=cloudbase 切换，前端零改动。
//
// 为什么不用 SQL / 常驻容器：
//  1) 官方社区确认：免费/个人版环境 PostgreSQL 的 TCP 直连走不通（内网互联不支持、公网直连开不了）；
//  2) 资源点计费表里云托管常驻容器会迅速烧光 FREE 的 3000 点/月，必须走按调用计费的云函数；
//  3) 云函数无持久文件系统，SQLite 文件不可用。
// 因此选文档型数据库 + @cloudbase/node-sdk：SDK 由平台注入凭证，不走 TCP 直连；
// 官方提供 runTransaction 事务，可保证「查重 + 扣减 + 落库」原子。
//
// 事务设计（重要）：CloudBase 事务内只保证 .doc(id) 的 get/add/update/set/delete，
// where() 查询在事务内不可靠。因此：
//  - 候选结果项在【事务外】只读查出（where + JS 过滤），选出 chosen；
//  - 参与记录用【确定性 _id】= 'p_' + sha256(drawId + '\0' + name)，防重复直接 .doc(pid).get() 判定；
//    关闭防重复时 pid 加随机后缀，每次独立；
//  - 事务内只做 .doc().get() 复核 + _.inc(-1) 原子扣减 + .doc().set() 落库，全部落在官方支持范围内。
//
// 文档里 _id 与业务 id 同值并冗余存一份 id，便于 exportAll 与现有备份 JSON 互相兼容。
const crypto = require('crypto');
// F1：与 db.js 共用同一份排序 UMD（本文件在云函数里不与 db.js 同时存在，无法互相 require）
const { sortRows } = require('./public/lib/result-sort');

const MODE = 'cloudbase';
const USE_MOCK = process.env.CLOUDBASE_MOCK === '1';

let cloudbase, app, db, _;

function genId(bytes = 6) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashId(s) { return crypto.createHash('sha256').update(String(s)).digest('base64url').slice(0, 22); }

// doc().get() 在服务端 SDK 返回 { data: [doc] }，where().get() 返回 { data: [docs] }；统一成数组。
function docs(res) {
  const d = res && res.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return [d];
  return [];
}
// 去掉 _id，保留冗余的 id 字段，返回结构与 db.js 一致。
function strip(doc) {
  if (!doc) return null;
  const out = { ...doc };
  delete out._id;
  return out;
}

async function init() {
  cloudbase = USE_MOCK ? require('./cloudbase-mock') : require('@cloudbase/node-sdk');
  app = cloudbase.init({
    env: process.env.CLOUDBASE_ENV_ID || cloudbase.SYMBOL_CURRENT_ENV || cloudbase.SYMBOL_DEFAULT_ENV,
    accessKey: process.env.CLOUDBASE_APIKEY || undefined
  });
  db = app.database();
  _ = db.command;
  // 集合首次需创建；已存在会报错，忽略即可。若 SDK 无此方法也跳过（控制台手动建同样可行）。
  for (const name of ['draws', 'results', 'participants']) {
    try { if (db.createCollection) await db.createCollection(name); } catch (_e) { /* 已存在 */ }
  }
  console.log('[db] 模式: cloudbase（文档数据库）', USE_MOCK ? '[mock]' : '');
}
const ready = init();

// ---- 查询辅助：只用等值 where + orderBy，组合条件一律在 JS 里过滤，避免方言风险 ----
async function query(name, where, orderBy, limit = 1000) {
  let q = db.collection(name);
  if (where && Object.keys(where).length) q = q.where(where);
  if (orderBy) q = q.orderBy(orderBy[0], orderBy[1] || 'asc');
  const res = await q.limit(limit).get();
  return docs(res).map(strip);
}
async function removeWhere(name, where) {
  // 先取回 _id 再逐个删，避免依赖 where().remove() 的批量语义差异。
  const rows = await query(name, where);
  for (const r of rows) await db.collection(name).doc(r.id).remove();
  return rows.length;
}
async function clearCollection(name) { return removeWhere(name, {}); }

// ---- 抽签活动 ----
async function createDraw({ title, description = '', antiDuplicate = true, items = [] }) {
  const id = genId(6);
  await db.collection('draws').add({
    data: {
      _id: id, id,
      title: String(title), description: String(description || ''),
      status: 'open', anti_duplicate: antiDuplicate ? 1 : 0, created_at: Date.now()
    }
  });
  const list = items || [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const rid = genId(5);
    const limit = (it.limit == null || it.limit === '' || Number(it.limit) < 0) ? -1 : parseInt(it.limit, 10);
    const weight = parseFloat(it.weight) > 0 ? parseFloat(it.weight) : 1;
    await db.collection('results').add({
      data: {
        _id: rid, id: rid, draw_id: id,
        name: String(it.name), description: String(it.description || ''),
        limit_count: limit, weight, color: String(it.color || '#22d3ee'),
        remaining: limit === -1 ? -1 : limit, sort_order: i
      }
    });
  }
  return getDrawRaw(id);
}

async function getDrawRaw(id) {
  const d = strip(docs(await db.collection('draws').doc(id).get())[0]);
  if (!d) return null;
  const items = await query('results', { draw_id: id }, ['sort_order', 'asc']);
  return { ...d, items };
}

async function getDrawPublic(id) {
  const d = strip(docs(await db.collection('draws').doc(id).get())[0]);
  if (!d) return null;
  return {
    id: d.id, title: d.title, description: d.description,
    status: d.status, antiDuplicate: !!d.anti_duplicate
  };
}

async function updateDraw(id, patch) {
  const cur = await getDrawRaw(id);
  if (!cur) return null;
  await db.collection('draws').doc(id).update({
    data: {
      title: patch.title != null ? String(patch.title) : cur.title,
      description: patch.description != null ? String(patch.description) : cur.description,
      status: patch.status != null ? patch.status : cur.status,
      anti_duplicate: patch.antiDuplicate ? 1 : 0
    }
  });

  if (Array.isArray(patch.items)) {
    const existing = await query('results', { draw_id: id });
    const incomingIds = patch.items.map(i => i.id).filter(Boolean);
    for (const e of existing) {
      if (!incomingIds.includes(e.id)) await db.collection('results').doc(e.id).remove();
    }
    for (let i = 0; i < patch.items.length; i++) {
      const it = patch.items[i];
      const limit = (it.limit == null || it.limit === '' || Number(it.limit) < 0) ? -1 : parseInt(it.limit, 10);
      const weight = parseFloat(it.weight) > 0 ? parseFloat(it.weight) : 1;
      const data = {
        name: String(it.name), description: String(it.description || ''),
        limit_count: limit, weight, color: String(it.color || '#22d3ee'), sort_order: i
      };
      if (it.id && existing.find(e => e.id === it.id)) {
        const used = (await query('participants', { draw_id: id, result_id: it.id })).length;
        data.remaining = limit === -1 ? -1 : Math.max(0, limit - used);
        await db.collection('results').doc(it.id).update({ data });
      } else {
        const rid = genId(5);
        await db.collection('results').add({
          data: { ...data, _id: rid, id: rid, draw_id: id, remaining: limit === -1 ? -1 : limit }
        });
      }
    }
  }
  return getDrawRaw(id);
}

async function deleteDraw(id) {
  await removeWhere('participants', { draw_id: id });
  await removeWhere('results', { draw_id: id });
  await db.collection('draws').doc(id).remove();
}

async function listDraws() {
  const draws = await query('draws', null, ['created_at', 'desc']);
  const out = [];
  for (const d of draws) {
    const parts = await query('participants', { draw_id: d.id });
    const items = (await query('results', { draw_id: d.id }, ['sort_order', 'asc']))
      .map(s => ({ id: s.id, name: s.name, limit_count: s.limit_count, remaining: s.remaining, color: s.color }));
    out.push({ ...d, participantCount: parts.length, items });
  }
  return out;
}

async function participants(drawId) {
  // query() 默认 limit(1000)，显式传 10000 与 db.js 的「无上限」对齐，避免大名单被截断（R4）
  const rows = await query('participants', { draw_id: drawId }, ['drawn_at', 'desc'], 10000);
  return rows.map(p => ({ id: p.id, name: p.name, resultName: p.result_name, drawnAt: p.drawn_at }));
}

// ---- 核心：执行抽签（事务，保证限量不超发）----
async function performDraw({ drawId, name }) {
  name = (name || '').trim();
  if (!name) return { error: 'name_required' };
  try {
    const d = strip(docs(await db.collection('draws').doc(drawId).get())[0]);
    if (!d) return { error: 'not_found' };
    if (d.status !== 'open') return { closed: true };

    // 候选集在事务外查出（事务内只支持 .doc() 操作）
    const allItems = await query('results', { draw_id: drawId }, ['sort_order', 'asc']);
    const avail = allItems.filter(r => r.limit_count === -1 || r.remaining > 0);
    if (!avail.length) return { soldOut: true };
    const totalW = avail.reduce((s, r) => s + (r.weight || 1), 0);
    let r = Math.random() * totalW;
    let chosen = avail[0];
    for (const a of avail) { r -= (a.weight || 1); if (r <= 0) { chosen = a; break; } }

    const anti = !!d.anti_duplicate;
    const pid = anti ? 'p_' + hashId(drawId + '\0' + name) : 'p_' + genId(6);

    const txRes = await db.runTransaction(async (transaction) => {
      const P = transaction.collection('participants');
      const R = transaction.collection('results');
      const D = transaction.collection('draws');

      const dd = strip(docs(await D.doc(drawId).get())[0]);
      if (!dd) return { error: 'not_found' };
      if (dd.status !== 'open') return { closed: true };

      if (anti) {
        const ex = strip(docs(await P.doc(pid).get())[0]);
        if (ex) return { alreadyDrawn: true, result: { id: ex.result_id, name: ex.result_name } };
      }

      // 复核 chosen 余量：并发下可能已被别人抽走
      const cur = strip(docs(await R.doc(chosen.id).get())[0]);
      if (!cur || (cur.limit_count !== -1 && cur.remaining <= 0)) return { soldOut: true };
      if (cur.limit_count !== -1) {
        await R.doc(chosen.id).update({ data: { remaining: _.inc(-1) } });
      }
      await P.doc(pid).set({
        data: {
          _id: pid, id: pid, draw_id: drawId, name,
          result_id: chosen.id, result_name: chosen.name, drawn_at: Date.now()
        }
      });
      return {
        ok: true,
        result: { id: chosen.id, name: chosen.name, description: chosen.description, color: chosen.color }
      };
    });
    // runTransaction 返回 { result: <updateFunction 返回值>, errMsg: 'runTransaction:ok' }
    return txRes && txRes.result !== undefined ? txRes.result : txRes;
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
  // 显式传 limit=10000 消除 query() 默认 limit(1000) 与 db.js 的行为差异（AC-1.7 / R4）。
  // 排序调用与 db.js 写法完全一致：同为 snake_case 字段名的 accessor。
  const rows = await query('participants', { draw_id: drawId }, ['drawn_at', 'asc'], 10000);
  const sorted = sortRows(rows, r => r.result_name, r => r.drawn_at, r => r.id);
  const lines = [['姓名', '抽签结果', '抽签时间'].join(',')];
  for (const r of sorted) {
    const t = new Date(Number(r.drawn_at)).toLocaleString('zh-CN', { hour12: false });
    lines.push([csvCell(r.name), csvCell(r.result_name), csvCell(t)].join(','));
  }
  return '\ufeff' + lines.join('\r\n');
}

// ---- 完整备份 / 恢复（与底层无关）----
async function exportAll() {
  const draws = await query('draws', null, ['created_at', 'asc']);
  const out = [];
  for (const d of draws) {
    const items = await query('results', { draw_id: d.id }, ['sort_order', 'asc']);
    const parts = await query('participants', { draw_id: d.id }, ['drawn_at', 'asc']);
    out.push({ ...d, items, participants: parts });
  }
  return { version: 1, exportedAt: new Date().toISOString(), mode: MODE, draws: out };
}

async function importAll(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.draws)) throw new Error('备份文件格式不正确');
  // 备份恢复是一次性运维操作，数据量可能超过单事务限制，故逐条写入（先清空）。
  // 与 db.js 的事务版语义一致：覆盖目标库全部数据。
  await clearCollection('participants');
  await clearCollection('results');
  await clearCollection('draws');
  for (const d of data.draws) {
    await db.collection('draws').add({
      data: {
        _id: d.id, id: d.id, title: String(d.title || ''), description: String(d.description || ''),
        status: d.status || 'open', anti_duplicate: d.anti_duplicate ? 1 : 0,
        created_at: Number(d.created_at) || Date.now()
      }
    });
    for (const it of (d.items || [])) {
      await db.collection('results').add({
        data: {
          _id: it.id, id: it.id, draw_id: d.id, name: String(it.name),
          description: String(it.description || ''), limit_count: Number(it.limit_count),
          weight: Number(it.weight) || 1, color: it.color || '#22d3ee',
          remaining: Number(it.remaining), sort_order: Number(it.sort_order) || 0
        }
      });
    }
    for (const p of (d.participants || [])) {
      await db.collection('participants').add({
        data: {
          _id: p.id, id: p.id, draw_id: d.id, name: String(p.name),
          result_id: p.result_id || null, result_name: p.result_name || null,
          drawn_at: Number(p.drawn_at) || Date.now()
        }
      });
    }
  }
  return { ok: true, draws: data.draws.length };
}

module.exports = {
  ready, MODE,
  createDraw, getDrawRaw, getDrawPublic, updateDraw, deleteDraw,
  listDraws, participants, performDraw, stats, exportCSV,
  exportAll, importAll
};
