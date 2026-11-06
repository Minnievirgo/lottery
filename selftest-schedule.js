// selftest-schedule.js —— 发言顺序排程 / 校验 / 容量 / SpreadsheetML 结构纯 Node 单测
//   node selftest-schedule.js
// 覆盖 AC-2.1 ~ AC-2.14；不触碰数据库、不需要浏览器、不新增任何 npm 依赖。
'use strict';

const assert = require('node:assert/strict');
const sc = require('./public/lib/schedule');
const xl = require('./public/lib/spreadsheetml');
const { sortRows } = require('./public/lib/result-sort');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}
function params(over) {
  const v = sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: '测试标题' }, over || {}));
  assert.equal(v.ok, true, '参数应合法，实际 fields=' + JSON.stringify(v.fields || {}));
  return v.params;
}
function named(names) { return names.map(n => ({ name: n })); }
function compute(names, over) {
  const p = params(over);
  const slots = sc.computeSlots(named(names), p);
  return { p, slots, plan: sc.buildPlan(slots, p) };
}

const NAMES8 = ['宋亚轩', '贾玉婵', '宋白', '林漪挺', '刘耀文', '白敬亭', '张真源', '第8人'];

console.log('发言顺序排程单测开始');

// ---- 时间工具 ----
test('parseHHmm / fmtHHmm 严格格式与整数分钟', () => {
  assert.equal(sc.parseHHmm('08:40'), 520);
  assert.equal(sc.parseHHmm('00:00'), 0);
  assert.equal(sc.parseHHmm('23:59'), 1439);
  assert.ok(isNaN(sc.parseHHmm('8:40')));
  assert.ok(isNaN(sc.parseHHmm('24:00')));
  assert.ok(isNaN(sc.parseHHmm('12:60')));
  assert.equal(sc.fmtHHmm(520), '08:40');
  assert.equal(sc.fmtHHmm(1439), '23:59');
  assert.equal(sc.fmtHHmm(1440), '24:00', '越界不取模，便于 QA 看出');
});

// ---- AC-2.1 / AC-2.2：默认参数推演表逐行复现 ----
test('AC-2.1 默认参数 7 人时间线 + 休息行 + 第 8 人 10:35', () => {
  const { slots, plan } = compute(NAMES8);
  assert.equal(plan.ok, true);
  const expected = [
    ['08:40', '08:50'], ['08:55', '09:05'], ['09:10', '09:20'], ['09:25', '09:35'],
    ['09:40', '09:50'], ['09:55', '10:05'], ['10:10', '10:20'], ['10:35', '10:45']
  ];
  for (let i = 0; i < expected.length; i++) {
    assert.equal(sc.fmtHHmm(slots[i].start), expected[i][0], '第 ' + (i + 1) + ' 人开始');
    assert.equal(sc.fmtHHmm(slots[i].end), expected[i][1], '第 ' + (i + 1) + ' 人结束');
  }
  const br = plan.rows.filter(r => r.kind === 'break');
  assert.equal(br.length, 1, '仅一处课间休息');
  assert.equal(br[0].text, '课间休息15分钟', '休息文案');
  const persons = plan.rows.filter(r => r.kind === 'person');
  assert.equal(persons.length, 8);
  assert.equal(persons[7].start, '10:35', 'Q3 覆盖规则：第 8 人 10:35 开始');
  assert.equal(persons[7].end, '10:45');
  assert.equal(persons[7].seq, 8, '序号跨休息不重置');
});

test('AC-2.2 相邻步长 = D+G = 15；休息处 = D+M = 25（10:10 → 10:35）', () => {
  const { slots } = compute(NAMES8);
  for (let i = 1; i < 7; i++) {
    assert.equal(slots[i].start - slots[i - 1].start, 15, '相邻两人开始差 15 分钟');
  }
  assert.equal(slots[7].start - slots[6].start, 25, '休息处开始差 25 分钟');
  assert.equal(slots[6].end + 15, slots[7].start, '开始 = 上一位结束 + M（不叠加 G）');
});

test('7 人数据不产生休息行（无下一位时 pendingBreak 不触发）', () => {
  const { plan } = compute(NAMES8.slice(0, 7));
  assert.equal(plan.ok, true);
  assert.equal(plan.rows.filter(r => r.kind === 'break').length, 0);
});

// ---- AC-2.3 / AC-2.4：休息开关与 N/M 可配 ----
test('AC-2.3 关闭课间休息后无休息行且时间线按步长连续', () => {
  const { slots, plan } = compute(NAMES8, { breakEnabled: false });
  assert.equal(plan.rows.filter(r => r.kind === 'break').length, 0);
  for (let i = 1; i < slots.length; i++) {
    assert.equal(slots[i].start - slots[i - 1].start, 15);
  }
  assert.equal(sc.fmtHHmm(slots[7].start), '10:25');
});

test('AC-2.4 N=5 / M=10：休息行在第 5 人之后，文案「课间休息10分钟」', () => {
  const { plan } = compute(NAMES8, { breakEvery: 5, breakMinutes: 10 });
  const rows = plan.rows;
  const brIdx = rows.findIndex(r => r.kind === 'break');
  assert.ok(brIdx > 0, '应有休息行');
  assert.equal(rows[brIdx].text, '课间休息10分钟');
  const personsBefore = rows.slice(0, brIdx).filter(r => r.kind === 'person');
  assert.equal(personsBefore.length, 5, '休息行紧跟第 5 人');
  const after = rows[brIdx + 1];
  assert.equal(after.kind, 'person');
  assert.equal(after.start, '10:00', '第 6 人 = 09:50 + 10 分钟');
});

// ---- AC-2.5：上午排满自动接下午 ----
test('AC-2.5 上午排满插「午休」行、下午首位 14:00、序号连续不重置', () => {
  const names = [];
  for (let i = 1; i <= 15; i++) names.push('第' + i + '人');
  const { slots, plan } = compute(names, { breakEnabled: false });
  assert.equal(plan.ok, true, '15 人默认容量内不应越界');
  const lunch = plan.rows.filter(r => r.kind === 'lunch');
  assert.equal(lunch.length, 1, '恰好一行「午休」');
  assert.equal(lunch[0].text, '午休');
  const persons = plan.rows.filter(r => r.kind === 'person');
  assert.equal(persons.length, 15);
  const pm = persons.filter(r => r.period === 'pm');
  assert.ok(pm.length >= 2, '应有下午段');
  assert.equal(pm[0].start, '14:00', '下午首位从下午开始时间起');
  for (let i = 0; i < persons.length; i++) {
    assert.equal(persons[i].seq, i + 1, '序号 1..N 连续，跨上午/下午不重置');
  }
  assert.equal(slots.filter(s => s.switched).length, 1, '仅切换一次');
});

// ---- AC-2.6：空列带边框 ----
test('AC-2.6 「日期 / 分公司」生成带 sCell 样式但无 <Data> 的空单元格', () => {
  const { plan } = compute(NAMES8);
  const xml = xl.buildWorkbook(plan.rows, plan.params);
  const persons = plan.rows.filter(r => r.kind === 'person').length;
  const emptyCount = (xml.match(/<Cell ss:StyleID="sCell"\/>/g) || []).length;
  assert.equal(emptyCount, persons * 2, '每个数据行恰好 2 个空单元格（C/D）');
  assert.ok(xml.includes('<Cell ss:StyleID="sCell"/>'), '空单元格写法正确');
});

// ---- AC-2.8 / AC-2.9：参数校验边界 ----
test('AC-2.8 时长 0 / -1 / 空 / 非整数 均拦截；间隔 -1 拦截、0 允许', () => {
  for (const d of [0, -1, '', 'abc', 1.5]) {
    const v = sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: 'T', duration: d }));
    assert.equal(v.ok, false, 'duration=' + JSON.stringify(d) + ' 应拦截');
    assert.ok(v.fields.duration, 'duration 字段提示');
  }
  assert.equal(sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: 'T', gap: -1 })).fields.gap,
    '发言间隔不能为负数');
  assert.equal(sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: 'T', gap: 0 })).ok, true,
    'gap=0 允许（无缝衔接）');
  assert.equal(sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: 'T', gap: 0, duration: 10 })).ok, true);
});

test('AC-2.9 时段倒挂 / 格式非法 / 休息参数 / 标题 / 备注 逐字段拦截', () => {
  const bad = [
    [{ amStart: '12:00', amEnd: '08:40' }, 'amEnd'],
    [{ pmStart: '11:00' }, 'pmStart'],                 // 11:00 <= amEnd 12:00
    [{ pmStart: '18:00', pmEnd: '17:00' }, 'pmEnd'],
    [{ amStart: '25:00' }, 'amStart'],
    [{ amEnd: '8:40' }, 'amEnd'],
    [{ breakEvery: 0 }, 'breakEvery'],
    [{ breakMinutes: -1 }, 'breakMinutes'],
    [{ title: '' }, 'title'],
    [{ remark: 'x'.repeat(201) }, 'remark']
  ];
  for (const [over, key] of bad) {
    const v = sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: 'T' }, over));
    assert.equal(v.ok, false, JSON.stringify(over) + ' 应拦截');
    assert.ok(v.fields[key], '应给出 ' + key + ' 字段提示，实际 ' + JSON.stringify(v.fields));
  }
  assert.equal(sc.validateParams(Object.assign({}, sc.DEFAULTS, { title: 'T', breakEnabled: false, breakEvery: 0 })).ok,
    true, '关闭休息时跳过 breakEvery 校验');
});

// ---- AC-2.10：容量预演算 ----
test('AC-2.10 超容量返回 capacity/total/overflow 自洽且不产出 rows', () => {
  const names = [];
  for (let i = 1; i <= 60; i++) names.push('第' + i + '人');
  const p = params();
  const slots = sc.computeSlots(named(names), p);
  const plan = sc.buildPlan(slots, p);
  assert.equal(plan.ok, false);
  assert.equal(plan.error, 'capacity_exceeded');
  assert.equal(plan.total, 60);
  assert.equal(plan.overflow, 60 - plan.capacity);
  assert.ok(plan.capacity > 0 && plan.capacity < 60);
  assert.equal(plan.rows, undefined, 'Z>0 时不返回任何表格行（不生成文件）');
  assert.ok(plan.message.includes('最多可安排 ' + plan.capacity + ' 人'));
  assert.ok(plan.message.includes('当前 60 人'));
  assert.ok(plan.message.includes('超出 ' + plan.overflow + ' 人'));
  assert.equal(plan.advice, sc.ADVICE);
});

test('截断到 capacity 人时必然可排（X = Y − Z 自洽）', () => {
  const names = [];
  for (let i = 1; i <= 60; i++) names.push('第' + i + '人');
  const p = params();
  const full = sc.buildPlan(sc.computeSlots(named(names), p), p);
  const cap = full.capacity;
  const trimmed = sc.buildPlan(sc.computeSlots(named(names.slice(0, cap)), p), p);
  assert.equal(trimmed.ok, true, '截断到 capacity 人应可排');
  assert.equal(trimmed.personCount, cap);
});

// ---- AC-2.11 / AC-2.12：备注与标题 ----
test('AC-2.11 备注内容同步；备注清空后仍生成空备注行', () => {
  const a = compute(NAMES8, { remark: '自定义备注：请准时到场' });
  const xml = xl.buildWorkbook(a.plan.rows, a.p.params);
  assert.ok(xml.includes('自定义备注：请准时到场'));
  const b = compute(NAMES8, { remark: '' });
  assert.equal(b.plan.rows[b.plan.rows.length - 1].kind, 'remark', '备注行仍存在');
  assert.equal(b.plan.rows[b.plan.rows.length - 1].text, '');
  assert.ok(xl.buildWorkbook(b.plan.rows, b.p.params).includes('<Data ss:Type="String"></Data>'));
});

test('AC-2.12 标题同步进大标题；文件名含标题且以 .xls 结尾', () => {
  const { plan } = compute(NAMES8, { title: '2026年度答辩发言顺序' });
  const xml = xl.buildWorkbook(plan.rows, plan.params);
  assert.ok(xml.includes('<Data ss:Type="String">2026年度答辩发言顺序</Data>'));
  const cd = xl.contentDisposition('2026年度答辩发言顺序');
  assert.ok(cd.includes('filename="schedule.xls"'));
  assert.ok(cd.includes("filename*=UTF-8''"));
  assert.ok(cd.endsWith('.xls'));
  assert.ok(cd.indexOf("filename*=UTF-8''") > cd.indexOf('filename="schedule.xls"'), 'filename* 放最后');
  assert.ok(cd.includes(encodeURIComponent('2026年度答辩发言顺序-发言顺序.xls')));
});

// ---- XMLSS 骨架 / 合并索引 ----
test('XMLSS 骨架：ProgID、无 BOM、无 <MergeCells>、ExpandedRowCount 精确', () => {
  const { plan } = compute(NAMES8);
  const xml = xl.buildWorkbook(plan.rows, plan.params);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'));
  assert.ok(!xml.startsWith('\ufeff'), 'UTF-8 无 BOM');
  assert.ok(!xml.includes('<MergeCells'), 'XMLSS 2003 无独立 MergeCells 元素');
  assert.ok(xml.includes('ss:ExpandedColumnCount="7"'));
  const m = /ss:ExpandedRowCount="(\d+)"/.exec(xml);
  assert.ok(m);
  assert.equal(Number(m[1]), plan.rows.length + 2, 'rowCount = plan.length + 2');
  const mergeAcross = (xml.match(/ss:MergeAcross="6"/g) || []).length;
  assert.equal(mergeAcross, plan.rows.filter(r => r.kind !== 'person').length + 1,
    'R1 + 每个整行合并行 各一次 MergeAcross=6');
});

test('mergeRuns：A 列纵向合并被 break/lunch/remark 强制断开，MergeDown 与 ss:Index=2 正确', () => {
  const { plan } = compute(NAMES8);
  const runs = xl.mergeRuns(plan.rows);
  assert.deepEqual(runs, [
    { startIdx: 0, len: 7, label: '上午' },
    { startIdx: 8, len: 1, label: '上午' }
  ], '休息行把 run 切成 7 + 1');
  const xml = xl.buildWorkbook(plan.rows, plan.params);
  assert.ok(xml.includes('ss:MergeDown="6"'), '首行 run len=7 → MergeDown=6');
  assert.ok(xml.includes('<Cell ss:Index="2" ss:StyleID="sCell"><Data ss:Type="Number">2</Data></Cell>'),
    'run 内非首行 B 单元格用 ss:Index="2" 跳过 A 列');
  // 整行合并行不得出现第二个 <Cell>
  const lunchLike = /<Cell ss:StyleID="sBreak" ss:MergeAcross="6"><Data ss:Type="String">课间休息15分钟<\/Data><\/Cell><\/Row>/.test(xml);
  assert.ok(lunchLike, '休息行独占整行且只输出锚点 Cell');
});

test('mergeRuns 在午休行处断开，下午 run 独立', () => {
  const names = [];
  for (let i = 1; i <= 15; i++) names.push('第' + i + '人');
  const { plan } = compute(names, { breakEnabled: false });
  const runs = xl.mergeRuns(plan.rows);
  assert.equal(runs.length, 2, '上午 / 下午各一个 run');
  assert.equal(runs[0].label, '上午');
  assert.equal(runs[1].label, '下午');
  assert.equal(runs[0].len, 13);
  const xml = xl.buildWorkbook(plan.rows, plan.params);
  assert.ok(xml.includes('ss:MergeDown="12"'), '上午 run 13 行 → MergeDown=12');
  assert.ok(!xml.includes('ss:MergeDown="14"'), '不得跨午休行合并');
});

test('escapeXml 注入防护与 sanitizeFilename 净化', () => {
  const evil = '<script>alert("x" & \'y\')</script>';
  const xml = xl.buildWorkbook([{ kind: 'remark', text: evil }], { title: evil, remark: evil });
  assert.ok(!xml.includes('<script>'), '标签必须转义');
  assert.ok(xml.includes('&lt;script&gt;'));
  assert.ok(xml.includes('&amp;'));
  assert.ok(xml.includes('&quot;'));
  assert.ok(xml.includes('&apos;'));
  assert.equal(xl.escapeXml('a\nb'), 'a&#10;b');
  assert.equal(xl.escapeXml('a\u0001b'), 'ab', 'XML 1.0 非法控制字符被剔除');
  assert.equal(xl.sanitizeFilename('  a/b:c*?d|"e"  '), 'abcde');
  assert.ok(!xl.contentDisposition('a/b:c').includes('a/b'));
});

// ---- AC-2.14：CSV 行序 === .xls 姓名列顺序 ----
test('AC-2.14 同一造数下 CSV 行序 === .xls 姓名列顺序（snake_case / camelCase 双 accessor）', () => {
  const base = 1700000000000;
  const snake = [
    { id: 'p1', name: '白敬亭', result_name: '38', drawn_at: base + 10 },
    { id: 'p2', name: '宋白', result_name: '13', drawn_at: base + 20 },
    { id: 'p3', name: '宋亚轩', result_name: '5', drawn_at: base + 30 },
    { id: 'p4', name: '刘耀文', result_name: '17', drawn_at: base + 40 },
    { id: 'p5', name: '张真源', result_name: '43', drawn_at: base + 50 },
    { id: 'p6', name: '林漪挺', result_name: '14', drawn_at: base + 60 },
    { id: 'p7', name: '贾玉婵', result_name: '6', drawn_at: base + 70 },
    { id: 'p8', name: '一等奖甲', result_name: '一等奖', drawn_at: base + 80 },
    { id: 'p9', name: '空值甲', result_name: null, drawn_at: base + 90 },
    { id: 'p10', name: '同值早', result_name: '5', drawn_at: base + 1 }
  ];
  // 模拟 db.js / db-cloudbase.js 的 exportCSV（snake_case 行）
  const csvOrder = sortRows(snake, r => r.result_name, r => r.drawn_at, r => r.id).map(r => r.name);
  // 模拟 server.js / admin.js 的 participants()（camelCase 行）
  const camel = snake.map(r => ({
    id: r.id, name: r.name, resultName: r.result_name, drawnAt: r.drawn_at
  }));
  const apiOrder = sortRows(camel, p => p.resultName, p => p.drawnAt, p => p.id);
  assert.deepEqual(apiOrder.map(p => p.name), csvOrder, '两种字段命名下排序逐行一致');

  const p = params({ breakEnabled: false });
  const slots = sc.computeSlots(apiOrder, p);
  const plan = sc.buildPlan(slots, p);
  assert.equal(plan.ok, true);
  const xlsOrder = plan.rows.filter(r => r.kind === 'person').map(r => r.name);
  assert.deepEqual(xlsOrder, csvOrder, 'CSV 行序 === .xls 姓名列顺序');

  // 进一步断言这些姓名在 XML 中按同一顺序出现
  const xml = xl.buildWorkbook(plan.rows, p);
  let cursor = 0;
  for (const name of csvOrder) {
    const i = xml.indexOf('>' + name + '<', cursor);
    assert.ok(i > cursor || (cursor === 0 && i >= 0), 'XML 中应出现姓名 ' + name);
    cursor = i + name.length;
  }
});

test('空名单不崩：computeSlots([]) → 仅备注行', () => {
  const p = params();
  const plan = sc.buildPlan(sc.computeSlots([], p), p);
  assert.equal(plan.ok, true);
  assert.equal(plan.personCount, 0);
  assert.deepEqual(plan.rows.map(r => r.kind), ['remark']);
});

console.log('✅ 发言顺序单测全部通过（' + passed + ' 项）');
