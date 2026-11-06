// selftest-qr.js —— QR vendor 矩阵不变量 / finder 完整性 / 分享 URL / 无裁切 静态断言
//   node selftest-qr.js
// 对应设计 §7.1 第 1 层验证方案；不引入任何 npm 依赖，纯 Node 运行。
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const qrcode = require('./public/vendor/qrcode.js');
const { makeShareUrl } = require('./public/lib/share-url.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

// 标准 7×7 finder pattern 模板（1 = 深色，0 = 浅色）
const FINDER = [
  '1111111',
  '1000001',
  '1011101',
  '1011101',
  '1011101',
  '1000001',
  '1111111'
];
const ORIGINS = [
  'http://localhost:3000',
  'https://xxx.onrender.com',
  'https://final.example.com'
];
const IDS = ['abcDEF123_-', 'p_9f3aBc'];

function makeMatrix(url) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const inst = qrcode(0, 'H');   // 0 = 版本自适应，'H' = 最高纠错（约 30% 容错）
  inst.addData(url, 'Byte');
  inst.make();
  return inst;
}
function bit(inst, r, c) { return inst.isDark(r, c) ? '1' : '0'; }
function checkFinder(inst, r0, c0) {
  const M = inst.getModuleCount();
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      assert.equal(bit(inst, r0 + r, c0 + c), FINDER[r][c],
        'finder(' + r0 + ',' + c0 + ') 在 (' + r + ',' + c + ') 与标准模板不符');
    }
  }
  assert.ok(r0 + 6 < M && c0 + 6 < M, 'finder 完整落在矩阵内');
}

console.log('QR / 分享链接单测开始');

// ---- vendor 自包含性与许可 ----
test('vendor 单文件可被 Node require，H 级、版本自适应、含完整 RS 实现', () => {
  assert.equal(typeof qrcode, 'function');
  assert.ok(qrcode.stringToBytesFuncs && typeof qrcode.stringToBytesFuncs['UTF-8'] === 'function');
  assert.ok(/RS_BLOCK_TABLE/.test(fs.readFileSync(path.join(ROOT, 'public/vendor/qrcode.js'), 'utf8')),
    '必须含完整 Reed-Solomon 块表（非简化纠错）');
  assert.ok(/QRErrorCorrectionLevel/.test(fs.readFileSync(path.join(ROOT, 'public/vendor/qrcode.js'), 'utf8')));
});

test('vendor ≤ 60 KB、无 require/import、MIT 头与来源 URL 逐字保留', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'public/vendor/qrcode.js'));
  const src = buf.toString('utf8');
  assert.ok(buf.length <= 60 * 1024, '文件应 ≤ 60 KB，实际 ' + buf.length + ' B');
  assert.ok(buf.length > 50 * 1024, '文件不应过小（疑似取错文件），实际 ' + buf.length + ' B');
  assert.equal((src.match(/\brequire\s*\(/g) || []).length, 0, '不得有 require(');
  assert.equal((src.match(/\bimport\s/g) || []).length, 0, '不得有 import');
  assert.ok(src.includes('Copyright (c) 2009 Kazuhiko Arase'), '上游 MIT 版权头');
  assert.ok(src.includes('The MIT License (MIT)'), '完整 MIT 许可正文');
  assert.ok(src.includes('实际来源'), '按 §7.1 注明实际来源 URL');
  assert.ok(src.includes('取用日期'), '按 §7.1 注明取用日期');
  assert.ok(src.includes('module.exports = factory()'), '底部 CommonJS 分支');
});

// ---- 三个 finder pattern 与静区 ----
test('三个 origin × 两个 drawId 的 URL：M 合法、三处 7×7 finder 逐格相等、separator 为白', () => {
  let count = 0;
  for (const origin of ORIGINS) {
    for (const id of IDS) {
      const url = makeShareUrl(origin, id);
      const inst = makeMatrix(url);
      const M = inst.getModuleCount();
      assert.ok(M >= 21, 'M ≥ 21，实际 ' + M);
      assert.equal((M - 17) % 4, 0, 'M = 4*version + 17，实际 ' + M);
      checkFinder(inst, 0, 0);
      checkFinder(inst, 0, M - 7);
      checkFinder(inst, M - 7, 0);
      // 左上 finder 的 separator（第 7 行 / 第 7 列）应为白，证明模块未被装饰覆盖
      for (let c = 0; c <= 7; c++) assert.equal(bit(inst, 7, c), '0', '第 7 行 separator 为白');
      for (let r = 0; r <= 7; r++) assert.equal(bit(inst, r, 7), '0', '第 7 列 separator 为白');
      count += 1;
    }
  }
  assert.equal(count, 6, '应覆盖 6 组 URL');
});

test('版本自适应：更长的 URL 得到更大的矩阵（仍满足 4v+17）', () => {
  const short = makeMatrix(makeShareUrl(ORIGINS[0], IDS[0])).getModuleCount();
  const long = makeMatrix(makeShareUrl(ORIGINS[2], IDS[0].repeat(6))).getModuleCount();
  assert.ok(long >= short, '长 URL 版本应不小于短 URL');
  assert.equal((long - 17) % 4, 0);
});

// ---- 分享 URL 唯一来源 ----
test('AC-3.1/3.2 makeShareUrl 三 origin 输出正确，末尾斜杠归一，无硬编码域名', () => {
  for (const origin of ORIGINS) {
    for (const id of IDS) {
      assert.equal(makeShareUrl(origin, id), origin + '/?d=' + encodeURIComponent(id));
    }
  }
  assert.equal(makeShareUrl('https://x.example///', 'id'), 'https://x.example/?d=id');
  assert.equal(makeShareUrl('', 'id'), '/?d=id');
  const shareSrc = fs.readFileSync(path.join(ROOT, 'public/lib/share-url.js'), 'utf8');
  assert.ok(!/localhost|onrender|final\.example|https?:\/\/[a-z]/i.test(shareSrc),
    '产品源码 share-url.js 不得出现任何域名常量');
  const adminSrc = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');
  assert.ok(adminSrc.includes('ShareUrl.makeShareUrl(location.origin, id)'),
    'copyLink 必须走同一函数');
  assert.ok(!/https?:\/\/[a-z]/i.test(adminSrc), 'admin.js 不得硬编码域名');
});

// ---- QR 渲染器：可扫性静态断言 ----
test('AC-3.4/R1 qr-render.js 无 clip / 无 destination-out，finder 标准实心方块、静区 4、H 级、plain 回退', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/qr-render.js'), 'utf8');
  assert.equal((src.match(/clip\s*\(/g) || []).length, 0, 'QR 层禁止裁切（全文件不使用 clip）');
  assert.ok(!src.includes('destination-out'), '不得擦除模块');
  assert.ok(src.includes('COSMIC_PALETTE'), '色值常量集中定义');
  assert.ok(src.includes("q(0, 'H')"), '纠错等级 H');
  assert.ok(src.includes('QUIET = 4'), '静区 4 模块');
  assert.ok(src.includes('isFinderRegion'), 'finder 区域判定');
  assert.ok(src.includes('ctx.fillRect(x, y, u, u)'), 'finder 用标准实心方块');
  assert.ok(src.includes('Math.SQRT2'), '方阵内接于圆，四角不裁');
  assert.ok(src.includes('plain'), '提供 plain:true 纯标准 QR 回退');
  assert.ok(src.includes('800'), '默认输出 800×800');
  assert.ok(!/requestAnimationFrame\s*\(/.test(src), '静态一帧，无动画循环调用');
  assert.ok(!/addEventListener\(['"]resize/.test(src), '不注册 resize 监听');
  assert.ok(!src.includes("getElementById('galaxy')") && !src.includes('getElementById("galaxy")'),
    '不依赖 cosmic-bg.js 的 DOM 节点');
});

test('COSMIC_PALETTE 色值与 admin.css / cosmic-bg.js 字面量一致（不改 cosmic-bg.js 本体）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/qr-render.js'), 'utf8');
  const bg = fs.readFileSync(path.join(ROOT, 'public/cosmic-bg.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/admin.css'), 'utf8');
  // 深蓝紫渐变底色来自后台 CSS（cosmic-bg.js 的画布底色由 CSS 提供，本身不含这三个 hex）
  for (const v of ['#11173a', '#0a0f24', '#02030a']) {
    assert.ok(src.includes(v), 'qr-render.js 应含背景色 ' + v);
    assert.ok(css.includes(v), 'admin.css 应含同源背景色 ' + v);
  }
  // 星云 / 金核 / 螺旋星点 / 星色来自 cosmic-bg.js
  for (const v of ['#5ad1ff', '#c4b5fd', '255,228,150', '205,175,255', '120,170,255',
    '255,238,185', '255,212,140', '150,130,255', '90,160,255', '120,90,220']) {
    assert.ok(src.includes(v), 'qr-render.js 应含色值 ' + v);
    assert.ok(bg.includes(v), 'cosmic-bg.js 应含同源色值 ' + v);
  }
});

// ---- 防回归：画布原点必须为整数（QA 第 2 轮固化，见 docs/QA-增量验收报告.md §5.3 / §11） ----
// 背景：SIZE=800 / PAD=24 / QUIET=4 时 L = u*G 可能是奇数，导致 ox = cx - L/2 为 .5；
// 半像素原点会让三个 7×7 finder 的实心方块之间出现抗锯齿白色细缝，降低可扫性。
// 避坑：本文件全篇共有 5 处 Math.round，其中 drawStarfield 的 Math.round(d * 2)
// 与画布原点无关，故禁止用「恰好 4 处 Math.round」的全局计数断言，改为精确匹配 4 个表达式。
const QR_RENDER_FILES = [
  'public/qr-render.js',
  'cloudbase/hosting/qr-render.js',
  'cloudbase/function/public/qr-render.js'
];
const ROUND_EXPRS = [
  'Math.round(cx - LPlain / 2)',
  'Math.round(cy - LPlain / 2)',
  'Math.round(cx - L / 2)',
  'Math.round(cy - L / 2)'
];
function occurrences(s, needle) { return s.split(needle).length - 1; }

test('防回归：主文件与 2 份镜像均含 4 处画布原点取整表达式，QR 层仍无 clip', () => {
  for (const rel of QR_RENDER_FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const expr of ROUND_EXPRS) {
      assert.equal(occurrences(src, expr), 1, rel + ' 应恰好含 1 处 ' + expr);
    }
    assert.equal((src.match(/clip\s*\(/g) || []).length, 0, rel + ' QR 层仍不得使用 clip()');
    assert.ok(!src.includes('destination-out'), rel + ' 仍不得擦除模块');
  }
  // 反证：这处与原点无关，若改成「全文件 Math.round 恰好 4 处」会误报
  const main = fs.readFileSync(path.join(ROOT, 'public/qr-render.js'), 'utf8');
  assert.ok(main.includes('Math.round(d * 2)'),
    'drawStarfield 超采样取整应保留（证明不能用全局 Math.round 计数）');
});

test('防回归：命中版本原点取整后为整数，且未取整值确为半像素（证明断言能抓到旧 Bug）', () => {
  const SIZE = 800, PAD = 24, QUIET = 4;
  function geom(M, mode) {
    const G = M + 2 * QUIET;
    const u = mode === 'plain'
      ? Math.max(1, Math.floor((SIZE - 2 * PAD) / G))
      : Math.max(1, Math.floor((SIZE - 2 * PAD) / (G * Math.SQRT2)));
    const L = u * G;
    return { G, u, L, raw: SIZE / 2 - L / 2, rounded: Math.round(SIZE / 2 - L / 2) };
  }
  // 先用真实 vendor 编码器确认这些 M 由真实 URL 可达（不是凭空构造的版本号）
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const matrixOf = (url) => {
    const i = qrcode(0, 'H'); i.addData(url, 'Byte'); i.make(); return i.getModuleCount();
  };
  assert.equal(matrixOf(makeShareUrl('http://localhost:3000', 'qa-draw-B')), 33, 'M=33 应由真实 URL 可达');
  assert.equal(matrixOf(makeShareUrl('http://localhost:3000', 'Zm9vYmFyLTIwMjY')), 37, 'M=37 应由真实 URL 可达');
  assert.equal(matrixOf(makeShareUrl('https://lottery-qa.onrender.com', 'Zm9vYmFyLTIwMjY')), 41, 'M=41 应由真实 URL 可达');
  assert.equal(matrixOf(makeShareUrl('https://lottery-qa.onrender.com', 'x'.repeat(64))), 57, 'M=57 应由真实 URL 可达');

  // [label, M, mode, 期望未取整值, 期望取整值, 是否命中半像素]
  const cases = [
    ['M=37 装饰版', 37, 'decorated', 152.5, 153, true],
    ['M=41 plain', 41, 'plain', 32.5, 33, true],
    ['M=57 plain', 57, 'plain', 42.5, 43, true],
    ['M=33 装饰版（对照，本已整数）', 33, 'decorated', 154, 154, false],
    ['M=41 装饰版（对照，本已整数）', 41, 'decorated', 155, 155, false],
    ['M=57 装饰版（对照，本已整数）', 57, 'decorated', 140, 140, false]
  ];
  for (const [label, M, mode, expRaw, expRounded, hit] of cases) {
    const g = geom(M, mode);
    assert.equal(g.raw, expRaw, label + ' 未取整原点应为 ' + expRaw + '，实际 ' + g.raw);
    assert.equal(g.rounded, expRounded, label + ' 取整后应为 ' + expRounded);
    assert.ok(Number.isInteger(g.rounded), label + ' 画布原点必须是整数');
    assert.equal(!Number.isInteger(g.raw), hit,
      label + ' 半像素命中状态不符（若全为 false 说明断言已失效，抓不到旧 Bug）');
  }
});

console.log('✅ QR / 分享链接单测全部通过（' + passed + ' 项）');
