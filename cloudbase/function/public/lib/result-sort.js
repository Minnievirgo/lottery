// public/lib/result-sort.js —— 「抽签结果」排序的唯一实现（UMD：Node + 浏览器）
//
// 被 db.js / db-cloudbase.js（snake_case 行）、server.js / admin.js（camelCase 行）
// 四处共用；F1 CSV、F2 .xls、名单弹窗逐行一致由「同一份比较逻辑」从构造上保证。
// 无 require、无 DOM、无 IO、无全局状态；返回新数组，不修改原数组、不修改行对象。
//
// 比较规则（优先级严格递减，见设计 §3.2 / PRD §4.1）：
//   1) kind 升序：0 数字 < 1 非数字文本 < 2 空值
//   2) kind=0：数值升序（"5" < "13" < "38"），不是字符串比较
//   3) kind=1：text.localeCompare(other, 'zh-CN') 字典序
//   4) 相等 → 次级键 Number(drawnAt) 升序（NaN / null 视为 0），先抽者在前
//   5) 仍相等 → String(id) 字典序（保证双驱动在同值同时间也逐行一致）
//   6) 仍相等 → 原始下标（decorate-sort-undecorate，稳定排序）
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ResultSort = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  // 仅接受十进制数值形态，避免 Number() 把 "0x10" 当 16、"Infinity" 当无穷。
  // 允许前后空白（调用侧会 trim）、可选正负号、小数与科学计数法。
  var NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  /**
   * 把一个「抽签结果」值归一化成可比较的键。
   * @param {*} v 任意值
   * @returns {{kind: number, num: number, text: string}} kind: 0=数字 1=非数字文本 2=空值
   */
  function normalizeResultValue(v) {
    if (v === null || v === undefined) {
      return { kind: 2, num: 0, text: '' };
    }
    var s = String(v).trim();
    if (s === '') {
      return { kind: 2, num: 0, text: '' };
    }
    if (NUMERIC_RE.test(s)) {
      var n = Number(s);
      if (isFinite(n)) {
        return { kind: 0, num: n, text: s };
      }
    }
    return { kind: 1, num: 0, text: s };
  }

  /** 比较两个归一化键，只比较「结果值」本身，不含时间 / id。 */
  function compareKeys(a, b) {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.kind === 0 && a.num !== b.num) return a.num < b.num ? -1 : 1;
    if (a.kind === 1) {
      var c = a.text.localeCompare(b.text, 'zh-CN');
      if (c < 0) return -1;
      if (c > 0) return 1;
    }
    return 0;
  }

  /**
   * 只比较两个「结果值」本身（供单测与任何需要裸值比较的场合使用）。
   * @param {*} a
   * @param {*} b
   * @returns {-1|0|1}
   */
  function compareResultName(a, b) {
    return compareKeys(normalizeResultValue(a), normalizeResultValue(b));
  }

  /**
   * 对行数组按结果升序排序，返回新数组。
   * @param {Array} rows 原始行数组
   * @param {function(*): *} getResult 取「抽签结果」值的 accessor
   * @param {function(*): *} getDrawnAt 取抽签时间的 accessor
   * @param {function(*): *} getId 取行 id 的 accessor（末级稳定兜底）
   * @returns {Array} 排序后的新数组（元素仍是原始行对象引用，未被修改）
   */
  function sortRows(rows, getResult, getDrawnAt, getId) {
    var list = Array.isArray(rows) ? rows : [];
    var gr = typeof getResult === 'function' ? getResult : function () { return null; };
    var gt = typeof getDrawnAt === 'function' ? getDrawnAt : function () { return null; };
    var gi = typeof getId === 'function' ? getId : function () { return ''; };

    var decorated = list.map(function (row, i) {
      var t = Number(gt(row));
      var idv = gi(row);
      return {
        row: row,
        i: i,
        key: normalizeResultValue(gr(row)),
        time: Number.isFinite(t) ? t : 0,
        id: String(idv == null ? '' : idv)
      };
    });

    decorated.sort(function (A, B) {
      var c = compareKeys(A.key, B.key);
      if (c !== 0) return c;
      if (A.time !== B.time) return A.time < B.time ? -1 : 1;
      if (A.id !== B.id) return A.id < B.id ? -1 : 1;
      return A.i - B.i;
    });

    return decorated.map(function (d) { return d.row; });
  }

  return {
    normalizeResultValue: normalizeResultValue,
    compareResultName: compareResultName,
    sortRows: sortRows
  };
}));
