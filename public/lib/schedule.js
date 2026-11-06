// public/lib/schedule.js —— 发言顺序排程算法（CommonJS，服务端唯一实现，纯函数无 IO）
//
// 全流程内部只用「整数分钟」，HH:mm 只在 validateParams 入口与 buildPlan 出口出现。
// 两阶段：阶段 A computeSlots 纯时间推演；阶段 B buildPlan 插分隔行 + 容量判定。
// 关键裁定：Q3 休息后下一位「开始 = 上一位结束 + M」覆盖间隔 G（不叠加）；
//           Q10 容量做完整预演算 X = Y - Z，Z > 0 时不生成文件；
//           D17 上午切下午时课间休息计数重新起算，且午休优先于课间休息。
'use strict';

// Q1 / Q2 / Q4 裁定默认值（前端表单与 localStorage 使用同一组字面量）
var DEFAULTS = {
  amStart: '08:40',
  amEnd: '12:00',
  pmStart: '14:00',
  pmEnd: '17:30',
  duration: 10,
  gap: 5,
  breakEnabled: true,
  breakEvery: 7,
  breakMinutes: 15,
  remark: '1、个人答辩时长每人13分钟，其中报告呈现10分钟，评委提问3分钟。'
};

var ADVICE = '建议缩短发言时长 / 间隔，或延长下午结束时间';

/**
 * 严格解析 HH:mm（24 小时制），返回整数分钟 0..1439；非法返回 NaN。
 * @param {*} s
 * @returns {number}
 */
function parseHHmm(s) {
  var str = String(s == null ? '' : s);
  var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(str);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * 整数分钟格式化为 HH:mm；n > 1439 时仍按绝对分钟输出（不取模，便于看出越界）。
 * @param {number} n
 * @returns {string}
 */
function fmtHHmm(n) {
  var v = Number(n);
  if (!Number.isFinite(v)) v = 0;
  var h = Math.floor(v / 60);
  var m = v % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** 剔除 \r\n 之外的 C0 控制字符与 DEL，防止写入 XML / 响应头时出问题。 */
function stripControls(s) {
  return String(s == null ? '' : s).replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** 只接受整数（number 或纯整数字符串），其余返回 NaN。 */
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^[+-]?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return NaN;
}

function pick(src, key, fallback) {
  var v = src[key];
  return (v === undefined || v === null) ? fallback : v;
}

/**
 * 服务端权威参数校验（前端只是同规则镜像）。
 * 缺失的非 title 字段与 DEFAULTS 合并；任一失败返回字段级中文提示。
 * @param {*} raw 请求体解析结果
 * @returns {{ok: true, params: Object} | {ok: false, error: string, fields: Object}}
 */
function validateParams(raw) {
  var src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  var fields = {};

  // ---- 表格标题：必填，trim 后 1..60 ----
  var title = stripControls(pick(src, 'title', '')).trim();
  if (title.length === 0) fields.title = '请填写表格标题';
  else if (title.length > 60) fields.title = '表格标题不能超过 60 字';

  // ---- 四个时间：格式 + 先后关系 ----
  var timeKeys = ['amStart', 'amEnd', 'pmStart', 'pmEnd'];
  var mins = {};
  for (var i = 0; i < timeKeys.length; i++) {
    var k = timeKeys[i];
    var rawVal = pick(src, k, DEFAULTS[k]);
    var n = parseHHmm(rawVal);
    if (isNaN(n)) {
      var label = { amStart: '上午开始', amEnd: '上午结束', pmStart: '下午开始', pmEnd: '下午结束' }[k];
      fields[k] = label + '时间格式不合法（需 HH:mm）';
    }
    mins[k] = n;
  }
  if (isFinite(mins.amStart) && isFinite(mins.amEnd) && !(mins.amEnd > mins.amStart)) {
    fields.amEnd = '上午结束时间必须晚于上午开始时间';
  }
  if (isFinite(mins.amEnd) && isFinite(mins.pmStart) && !(mins.pmStart > mins.amEnd)) {
    fields.pmStart = '下午开始时间必须晚于上午结束时间';
  }
  if (isFinite(mins.pmStart) && isFinite(mins.pmEnd) && !(mins.pmEnd > mins.pmStart)) {
    fields.pmEnd = '下午结束时间必须晚于下午开始时间';
  }

  // ---- 节奏：时长 > 0、间隔 >= 0 ----
  var duration = toInt(pick(src, 'duration', DEFAULTS.duration));
  if (isNaN(duration) || duration <= 0) fields.duration = '每人发言时长必须大于 0 分钟';
  var gap = toInt(pick(src, 'gap', DEFAULTS.gap));
  if (isNaN(gap) || gap < 0) fields.gap = '发言间隔不能为负数';

  // ---- 课间休息 ----
  var breakEnabled = pick(src, 'breakEnabled', DEFAULTS.breakEnabled);
  if (typeof breakEnabled !== 'boolean') fields.breakEnabled = '启用课间休息必须为布尔值';
  var breakEvery = toInt(pick(src, 'breakEvery', DEFAULTS.breakEvery));
  var breakMinutes = toInt(pick(src, 'breakMinutes', DEFAULTS.breakMinutes));
  if (breakEnabled === true) {
    if (isNaN(breakEvery) || breakEvery < 1) fields.breakEvery = '每 N 人休息必须是 ≥ 1 的整数';
    if (isNaN(breakMinutes) || breakMinutes < 0) fields.breakMinutes = '休息分钟数必须是 ≥ 0 的整数';
  }

  // ---- 备注：可为空，<= 200 字 ----
  var remark = stripControls(pick(src, 'remark', DEFAULTS.remark));
  if (remark.length > 200) fields.remark = '备注不能超过 200 字';

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: 'invalid_params', fields: fields };
  }

  return {
    ok: true,
    params: {
      title: title,
      amStart: String(pick(src, 'amStart', DEFAULTS.amStart)),
      amEnd: String(pick(src, 'amEnd', DEFAULTS.amEnd)),
      pmStart: String(pick(src, 'pmStart', DEFAULTS.pmStart)),
      pmEnd: String(pick(src, 'pmEnd', DEFAULTS.pmEnd)),
      duration: duration,
      gap: gap,
      breakEnabled: breakEnabled,
      breakEvery: isNaN(breakEvery) ? DEFAULTS.breakEvery : breakEvery,
      breakMinutes: isNaN(breakMinutes) ? DEFAULTS.breakMinutes : breakMinutes,
      remark: remark
    }
  };
}

/**
 * 阶段 A：对已按结果升序排好的行做纯时间推演，产出 Slot[]（不含表格行）。
 * @param {Array<{name: string}>} sortedRows
 * @param {Object} params validateParams 通过后的参数
 * @returns {Array<Object>} Slot[]
 */
function computeSlots(sortedRows, params) {
  var rows = Array.isArray(sortedRows) ? sortedRows : [];
  var p = params || {};
  var D = Number(p.duration);
  var G = Number(p.gap);
  var M = Number(p.breakMinutes);
  var N = Number(p.breakEvery);
  var amStart = parseHHmm(p.amStart);
  var amEnd = parseHHmm(p.amEnd);
  var pmStart = parseHHmm(p.pmStart);
  var pmEnd = parseHHmm(p.pmEnd);
  var breakEnabled = p.breakEnabled === true;

  var slots = [];
  var period = 'am';
  var lastEnd = null;
  var sinceBreak = 0;
  var pendingBreak = false;

  for (var i = 0; i < rows.length; i++) {
    var start;
    if (i === 0) {
      start = period === 'am' ? amStart : pmStart;
    } else if (pendingBreak) {
      // Q3：覆盖 G，不叠加 —— 复现 10:20 → 10:35
      start = lastEnd + M;
    } else {
      start = lastEnd + G;
    }
    var end = start + D;

    var switched = false;
    var breakApplied = pendingBreak;
    if (period === 'am' && end > amEnd) {
      // 上午排满 → 自动接下午；D17：午休优先于课间休息、计数重新起算
      period = 'pm';
      switched = true;
      breakApplied = false;
      sinceBreak = 0;
      start = pmStart;
      end = start + D;
    }

    var overflow = (period === 'pm' && end > pmEnd);
    slots.push({
      seq: i + 1,
      name: rows[i].name,
      start: start,
      end: end,
      period: period,
      switched: switched,
      breakApplied: breakApplied,
      overflow: overflow
    });

    lastEnd = end;
    pendingBreak = false;
    if (!overflow) {
      if (switched) sinceBreak = 1;
      else if (breakApplied) sinceBreak = 1;
      else sinceBreak += 1;
      // 只有「还有下一位」时才插休息行，避免末尾多出一行
      if (breakEnabled && sinceBreak >= N && i < rows.length - 1) {
        pendingBreak = true;
      }
    }
  }
  return slots;
}

/**
 * 阶段 B：插分隔行、容量判定、行号推进。
 * @param {Array<Object>} slots computeSlots 产出
 * @param {Object} params
 * @returns {{ok: true, rows: Array, personCount: number, params: Object} |
 *           {ok: false, error: string, message: string, capacity: number,
 *            total: number, overflow: number, advice: string}}
 */
function buildPlan(slots, params) {
  var list = Array.isArray(slots) ? slots : [];
  var p = params || {};
  var M = Number(p.breakMinutes);
  var plan = [];
  var emittedLunch = false;
  var Z = 0;

  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (s.overflow) { Z += 1; continue; }
    if (s.switched && !emittedLunch) {
      plan.push({ kind: 'lunch', text: '午休' });
      emittedLunch = true;
    } else if (s.breakApplied) {
      plan.push({ kind: 'break', text: '课间休息' + M + '分钟' });
    }
    plan.push({
      kind: 'person',
      seq: s.seq,
      name: s.name,
      start: fmtHHmm(s.start),
      end: fmtHHmm(s.end),
      period: s.period
    });
  }
  // 备注为空仍生成行（AC-2.11）
  plan.push({ kind: 'remark', text: p.remark == null ? '' : String(p.remark) });

  var Y = list.length;
  var X = Y - Z;
  if (Z > 0) {
    return {
      ok: false,
      error: 'capacity_exceeded',
      message: '当前时间参数最多可安排 ' + X + ' 人，当前 ' + Y + ' 人，超出 ' + Z + ' 人。' + ADVICE,
      capacity: X,
      total: Y,
      overflow: Z,
      advice: ADVICE
    };
  }
  return { ok: true, rows: plan, personCount: Y, params: p };
}

module.exports = {
  DEFAULTS: DEFAULTS,
  ADVICE: ADVICE,
  parseHHmm: parseHHmm,
  fmtHHmm: fmtHHmm,
  validateParams: validateParams,
  computeSlots: computeSlots,
  buildPlan: buildPlan
};
