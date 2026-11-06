// public/lib/spreadsheetml.js —— Excel 2003 SpreadsheetML（XMLSS）生成器（CommonJS，纯函数）
//
// 零依赖、纯字符串拼接，服务端 POST /export-schedule 使用。
// 关键约束（设计 §6.3 / 硬约束 4）：
//   * XMLSS 2003 没有独立 <MergeCells> 元素；合并只能靠锚点 <Cell> 的
//     ss:MergeAcross / ss:MergeDown，被合并单元格必须省略，用 ss:Index 跳列。
//   * A 列「上午/下午」纵向合并的 run 遇到 break / lunch / remark 整行合并处
//     必须强制断开，否则纵向合并与横向合并重叠会让 Excel 报「文件已损坏」。
//   * ss:ExpandedColumnCount / ss:ExpandedRowCount 必须精确（≥ 实际列 / 行数）。
//   * XML 声明后紧跟 <?mso-application progid="Excel.Sheet"?>；UTF-8 无 BOM。
'use strict';

var COLUMN_WIDTHS = [42, 42, 80, 90, 100, 80, 80];
var HEADERS = ['时段', '序号', '日期', '分公司', '姓名', '开始时间', '结束时间'];

/**
 * XML 文本转义：转义 & < > " '，剔除 XML 1.0 非法字符，换行转 &#10;。
 * @param {*} s
 * @returns {string}
 */
function escapeXml(s) {
  var str = String(s == null ? '' : s);
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  str = str.replace(/&/g, '&amp;')
           .replace(/</g, '&lt;')
           .replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;')
           .replace(/'/g, '&apos;');
  str = str.replace(/\r\n/g, '&#10;').replace(/\n/g, '&#10;').replace(/\r/g, '&#10;');
  return str;
}

/**
 * 文件名净化：trim，剔除 " \ / : * ? < > |、CR/LF 与 C0 控制字符，长度 ≤ 80。
 * @param {*} s
 * @returns {string}
 */
function sanitizeFilename(s) {
  var str = String(s == null ? '' : s).trim();
  str = str.replace(/["\\\/:*?<>|]/g, '');
  str = str.replace(/[\x00-\x1F\x7F]/g, '');
  return str.slice(0, 80);
}

/**
 * RFC 6266 / 5987 双形式 Content-Disposition；filename* 必须放最后。
 * @param {string} title 表格标题
 * @returns {string}
 */
function contentDisposition(title) {
  var name = sanitizeFilename(title) + '-发言顺序.xls';
  return 'attachment; filename="schedule.xls"; filename*=UTF-8\'\'' + encodeURIComponent(name);
}

/** 四边细黑框线（除 Default 外所有 Style 共用）。 */
function borders() {
  var pos = ['Left', 'Top', 'Right', 'Bottom'];
  var out = '<Borders>';
  for (var i = 0; i < pos.length; i++) {
    out += '<Border ss:Position="' + pos[i] + '" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>';
  }
  return out + '</Borders>';
}

function fontTag(name, size, bold, color, charset) {
  return '<Font ss:FontName="' + name + '"' + (charset ? ' x:CharSet="134"' : '') +
    ' ss:Size="' + size + '"' + (bold ? ' ss:Bold="1"' : '') + ' ss:Color="' + color + '"/>';
}

function alignmentTag(h, v, wrap) {
  return '<Alignment' + (h ? ' ss:Horizontal="' + h + '"' : '') +
    (v ? ' ss:Vertical="' + v + '"' : '') + (wrap ? ' ss:WrapText="1"' : '') + '/>';
}

function interiorTag(color) {
  return color ? '<Interior ss:Color="' + color + '" ss:Pattern="Solid"/>' : '<Interior/>';
}

function styleTag(id, inner, name) {
  return '<Style ss:ID="' + id + '"' + (name ? ' ss:Name="' + name + '"' : '') + '>' + inner + '</Style>';
}

/** 8 个 Style ID：Default / sTitle / sHead / sPeriod / sCell / sCellLeft / sBreak / sRemark。 */
function buildStyles() {
  var B = borders();
  var tail = '<NumberFormat/><Protection/>';
  var out = '<Styles>';

  out += styleTag('Default',
    alignmentTag('', 'Center') + '<Borders/>' + fontTag('宋体', 11, false, '#000000', true) + '<Interior/>' + tail,
    'Normal');
  out += styleTag('sTitle',
    alignmentTag('Center', 'Center') + B + fontTag('微软雅黑', 16, true, '#FFFFFF', false) + interiorTag('#1E4E9C') + tail);
  out += styleTag('sHead',
    alignmentTag('Center', 'Center') + B + fontTag('宋体', 11, true, '#C00000', true) + interiorTag('#FFFFFF') + tail);
  out += styleTag('sPeriod',
    alignmentTag('Center', 'Center', true) + B + fontTag('宋体', 11, true, '#000000', true) + interiorTag('#F2F6FF') + tail);
  out += styleTag('sCell',
    alignmentTag('Center', 'Center') + B + fontTag('宋体', 11, false, '#000000', true) + '<Interior/>' + tail);
  out += styleTag('sCellLeft',
    alignmentTag('Left', 'Center') + B + fontTag('宋体', 11, false, '#000000', true) + '<Interior/>' + tail);
  out += styleTag('sBreak',
    alignmentTag('Center', 'Center') + B + fontTag('宋体', 11, true, '#FFFFFF', true) + interiorTag('#2563B4') + tail);
  out += styleTag('sRemark',
    alignmentTag('Left', 'Center', true) + B + fontTag('宋体', 11, false, '#000000', true) + '<Interior/>' + tail);

  return out + '</Styles>';
}

/** 7 个固定列宽定义。 */
function buildColumnDefs() {
  var out = '';
  for (var i = 0; i < COLUMN_WIDTHS.length; i++) {
    out += '<Column ss:Index="' + (i + 1) + '" ss:Width="' + COLUMN_WIDTHS[i] + '"/>';
  }
  return out;
}

/**
 * 纯索引计算：把 plan 中的 person 行按「连续且未被 break/lunch/remark 打断」切成 run。
 * @param {Array<Object>} plan
 * @returns {Array<{startIdx: number, len: number, label: string}>}
 */
function mergeRuns(plan) {
  var rows = Array.isArray(plan) ? plan : [];
  var runs = [];
  var cur = null;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.kind === 'person') {
      if (!cur) {
        cur = { startIdx: i, len: 1, label: row.period === 'am' ? '上午' : '下午' };
        runs.push(cur);
      } else {
        cur.len += 1;
      }
    } else {
      // 整行合并处强制断开：不会出现纵向合并与横向合并重叠
      cur = null;
    }
  }
  return runs;
}

function strCell(s) {
  return '<Cell ss:StyleID="sCell"><Data ss:Type="String">' + escapeXml(s) + '</Data></Cell>';
}
function numCell(n, withIndex) {
  return '<Cell' + (withIndex ? ' ss:Index="2"' : '') + ' ss:StyleID="sCell"><Data ss:Type="Number">' +
    Number(n) + '</Data></Cell>';
}
function emptyCell() {
  // 无 <Data> 但 sCell 的四边框线仍生效（AC-2.6）
  return '<Cell ss:StyleID="sCell"/>';
}

/**
 * 生成 Table 内全部 Row，返回 { xml, rowCount }（rowCount = plan.length + 2）。
 * @param {Array<Object>} plan
 * @param {Object} params
 * @returns {{xml: string, rowCount: number}}
 */
function buildRows(plan, params) {
  var rows = Array.isArray(plan) ? plan : [];
  var p = params || {};
  var runs = mergeRuns(rows);
  var runAt = {};   // run 首行 plan 下标 -> run
  var inRun = {};   // run 内非首行 plan 下标 -> true
  for (var j = 0; j < runs.length; j++) {
    var run = runs[j];
    runAt[run.startIdx] = run;
    for (var k = 1; k < run.len; k++) inRun[run.startIdx + k] = true;
  }

  var parts = [];
  var rowNo = 1;

  // R1 大标题：跨全部 7 列（A1:G1）
  parts.push('<Row ss:Index="1" ss:Height="34" ss:AutoFitHeight="0">' +
    '<Cell ss:StyleID="sTitle" ss:MergeAcross="6"><Data ss:Type="String">' +
    escapeXml(p.title) + '</Data></Cell></Row>');
  rowNo = 2;

  // R2 表头
  var headCells = '';
  for (var h = 0; h < HEADERS.length; h++) {
    headCells += '<Cell ss:StyleID="sHead"><Data ss:Type="String">' + escapeXml(HEADERS[h]) + '</Data></Cell>';
  }
  parts.push('<Row ss:Index="2" ss:Height="26" ss:AutoFitHeight="0">' + headCells + '</Row>');
  rowNo = 3;

  // 数据行 / 整行合并行
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var height = (row.kind === 'remark') ? 40 : 22;
    var cells = '';
    if (row.kind === 'person') {
      var r = runAt[i];
      if (r) {
        // run 首行：A 单元格，len > 1 时纵向合并
        cells += '<Cell ss:StyleID="sPeriod"' +
          (r.len > 1 ? ' ss:MergeDown="' + (r.len - 1) + '"' : '') +
          '><Data ss:Type="String">' + escapeXml(r.label) + '</Data></Cell>';
        cells += numCell(row.seq, false);
      } else {
        // run 内其余行：A 不输出，B 用 ss:Index="2" 跳过
        cells += numCell(row.seq, true);
      }
      cells += emptyCell();       // C 日期
      cells += emptyCell();       // D 分公司
      cells += strCell(row.name); // E 姓名
      cells += strCell(row.start);// F 开始时间
      cells += strCell(row.end);  // G 结束时间
    } else {
      // break / lunch / remark：独占整行，跨 7 列，且不再输出任何其他 Cell
      var styleId = (row.kind === 'remark') ? 'sRemark' : 'sBreak';
      cells = '<Cell ss:StyleID="' + styleId + '" ss:MergeAcross="6"><Data ss:Type="String">' +
        escapeXml(row.text) + '</Data></Cell>';
    }
    parts.push('<Row ss:Index="' + rowNo + '" ss:Height="' + height + '" ss:AutoFitHeight="0">' + cells + '</Row>');
    rowNo += 1;
  }

  return { xml: parts.join(''), rowCount: rowNo - 1 };
}

/**
 * 拼接完整 XMLSS 文档（UTF-8 字符串，不加 BOM）。
 * @param {Array<Object>} plan
 * @param {Object} params
 * @returns {string}
 */
function buildWorkbook(plan, params) {
  var p = params || {};
  var rows = buildRows(plan, p);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:html="http://www.w3.org/TR/REC-html40">' +
    '<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>抽签系统</Author></DocumentProperties>' +
    '<ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">' +
      '<WindowHeight>9000</WindowHeight><WindowWidth>16000</WindowWidth>' +
      '<ProtectStructure>False</ProtectStructure><ProtectWindows>False</ProtectWindows>' +
    '</ExcelWorkbook>' +
    buildStyles() +
    '<Worksheet ss:Name="发言顺序">' +
      '<Table ss:ExpandedColumnCount="7" ss:ExpandedRowCount="' + rows.rowCount + '" ' +
        'x:FullColumns="1" x:FullRows="1" ss:DefaultColumnWidth="60" ss:DefaultRowHeight="20">' +
        buildColumnDefs() + rows.xml +
      '</Table>' +
      '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">' +
        '<PageSetup>' +
          '<PageMargins x:Bottom="0.5" x:Left="0.4" x:Right="0.4" x:Top="0.5"/>' +
          '<Layout x:Orientation="Landscape"/>' +
        '</PageSetup>' +
        '<Print><PaperSizeIndex>9</PaperSizeIndex></Print>' +
        '<Zoom>100</Zoom><Selected/>' +
        '<ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>' +
      '</WorksheetOptions>' +
    '</Worksheet>' +
  '</Workbook>';
}

module.exports = {
  escapeXml: escapeXml,
  sanitizeFilename: sanitizeFilename,
  contentDisposition: contentDisposition,
  buildStyles: buildStyles,
  buildColumnDefs: buildColumnDefs,
  mergeRuns: mergeRuns,
  buildRows: buildRows,
  buildWorkbook: buildWorkbook
};
