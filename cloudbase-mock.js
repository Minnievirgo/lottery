// cloudbase-mock.js —— @cloudbase/node-sdk 的最小内存实现，仅用于本地回归测试
//
// 用途：CLOUDBASE_MOCK=1 时，db-cloudbase.js 会加载本模块而不是真实 SDK，
// 从而在【没有云环境】的情况下也能跑完整 selftest.js，验证业务逻辑正确性。
// 实现范围覆盖 db-cloudbase.js 用到的全部 API：
//   init / SYMBOL_CURRENT_ENV / database().command.inc / createCollection /
//   collection().where().orderBy().limit().get() / .add() / .doc().get|update|set|remove /
//   runTransaction（快照 + 失败回滚）。
// 不模拟真实网络、并发、权限与资源点计费。
const crypto = require('crypto');

const store = { draws: new Map(), results: new Map(), participants: new Map() };

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function nid() { return crypto.randomBytes(8).toString('base64url'); }
function snapshot() {
  const s = {};
  for (const k of Object.keys(store)) s[k] = new Map(clone([...store[k]]));
  return s;
}
function restore(s) {
  for (const k of Object.keys(store)) store[k] = new Map(clone([...s[k]]));
}

// ---- 数据库命令 ----
const command = {
  inc: (n) => ({ __op: 'inc', __value: Number(n) }),
  gt: (n) => ({ __op: 'gt', __value: n }),
  lt: (n) => ({ __op: 'lt', __value: n }),
  exists: (b) => ({ __op: 'exists', __value: !!b }),
  or: (arr) => ({ __op: 'or', __value: arr })
};
function isCmd(v) { return v && typeof v === 'object' && typeof v.__op === 'string'; }
function applyCmd(cur, cmd) {
  switch (cmd.__op) {
    case 'inc': return Number(cur || 0) + cmd.__value;
    default: return cmd;
  }
}
function matchCond(doc, cond) {
  if (!cond) return true;
  for (const [k, v] of Object.entries(cond)) {
    const cur = doc[k];
    if (isCmd(v)) {
      if (v.__op === 'gt' && !(Number(cur) > Number(v.__value))) return false;
      else if (v.__op === 'lt' && !(Number(cur) < Number(v.__value))) return false;
      else if (v.__op === 'exists' && (cur !== undefined) !== v.__value) return false;
      else if (v.__op === 'or' && !v.__value.some(c => matchCond(doc, c))) return false;
    } else if (cur !== v) return false;
  }
  return true;
}

class DocRef {
  constructor(map, id) { this.map = map; this.id = id; }
  async get() {
    const d = this.map.get(this.id);
    return { data: d ? [clone(d)] : [] };
  }
  async update({ data }) {
    const cur = this.map.get(this.id);
    if (!cur) return { updated: 0 };
    const next = { ...cur };
    for (const [k, v] of Object.entries(data || {})) next[k] = isCmd(v) ? applyCmd(cur[k], v) : clone(v);
    this.map.set(this.id, next);
    return { updated: 1 };
  }
  async set({ data }) {
    const d = { ...clone(data || {}), _id: this.id };
    this.map.set(this.id, d);
    return { id: this.id };
  }
  async remove() {
    const had = this.map.delete(this.id);
    return { deleted: had ? 1 : 0 };
  }
}

class Query {
  constructor(name) {
    this.name = name;
    this._where = null;
    this._order = null;
    this._limit = 1000;
  }
  get map() { return store[this.name]; }
  where(cond) { this._where = cond; return this; }
  orderBy(field, dir) { this._order = { field, dir: dir === 'desc' ? 'desc' : 'asc' }; return this; }
  limit(n) { this._limit = n; return this; }
  doc(id) { return new DocRef(this.map, id); }
  _rows() {
    let rows = [...this.map.values()].filter(d => matchCond(d, this._where));
    if (this._order) {
      const { field, dir } = this._order;
      rows.sort((a, b) => {
        const x = a[field], y = b[field];
        const c = (x > y ? 1 : x < y ? -1 : 0);
        return dir === 'desc' ? -c : c;
      });
    }
    return rows.slice(0, this._limit);
  }
  async get() { return { data: this._rows().map(clone) }; }
  async count() { return { total: this._rows().length }; }
  async add({ data }) {
    const d = clone(data || {});
    const id = d._id || nid();
    d._id = id;
    if (this.map.has(id)) throw new Error('duplicate _id: ' + id);
    this.map.set(id, d);
    return { id };
  }
  async remove() {
    const rows = this._rows();
    for (const r of rows) this.map.delete(r._id);
    return { deleted: rows.length };
  }
}

class TxCollection {
  constructor(name) { this.name = name; }
  doc(id) { return new DocRef(store[this.name], id); }
}

const database = {
  command,
  createCollection: async (name) => { if (!store[name]) store[name] = new Map(); return { ok: true }; },
  collection: (name) => { if (!store[name]) store[name] = new Map(); return new Query(name); },
  runTransaction: async (fn) => {
    const snap = snapshot();
    try {
      const tx = { collection: (name) => { if (!store[name]) store[name] = new Map(); return new TxCollection(name); } };
      const value = await fn(tx);
      return { result: value, errMsg: 'runTransaction:ok' };
    } catch (e) {
      restore(snap);
      throw e;
    }
  }
};

module.exports = {
  SYMBOL_CURRENT_ENV: 'CURRENT_ENV',
  SYMBOL_DEFAULT_ENV: 'DEFAULT_ENV',
  init: () => ({ database: () => database })
};
