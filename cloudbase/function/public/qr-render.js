// public/qr-render.js —— 圆形圆点化分享二维码渲染（浏览器 IIFE，window.LotteryQR）
//
// 依赖 classic <script> 先加载的 public/vendor/qrcode.js（window.qrcode）。
// 与 public/cosmic-bg.js 完全独立：不引用、不修改它，不注册 resize / 动画循环，
// 中心星空图是离屏 Canvas 上「静态一帧」，无 requestAnimationFrame。
//
// 可扫性优先（设计 §7.2 / Q6 / R1，硬约束 6）：
//   * 三个 7×7 finder pattern 一律标准实心方块，不替换、不做圆角/环形变体、不裁切；
//   * 同心圆环是画在 QR 层【之下】外圈带的装饰，QR 模块后画会覆盖它，绝不遮挡模块；
//   * 圆形 = 白色圆形底 + 圆形描边（外框），QR 方阵【内接于圆】，四角不裁；
//   * QR 层全程不使用裁切（本文件任何地方都不用 clip，中心星空改用离屏
//     destination-in 合成得到圆形）；静区 4 模块；纠错等级 H；输出默认 800×800。
//   * plain:true 一步回退为「纯黑白标准 QR + 4 模块静区」，供真机解码失败时兜底。
//
// 色值与 public/cosmic-bg.js L24-31 / L44-46 / L92 保持一致（设计 §7.4）；
// 若日后调整背景配色，请同步修改本对象；本文件不引用、不修改 cosmic-bg.js。
(function (global) {
  'use strict';

  var COSMIC_PALETTE = {
    bg: ['#11173a', '#0a0f24', '#02030a'],
    nebula: ['150,130,255', '90,160,255', '120,90,220'],
    gold: ['255,238,185', '255,212,140'],
    cyan: '#5ad1ff',
    purple: '#c4b5fd',
    white: '#ffffff',
    ink: '#0B1026'
  };

  var QUIET = 4;   // 静区 ≥ 4 模块（Q7）
  var PAD = 24;    // 外圈描边 / 抗锯齿留白

  /** 取到 vendor 全局 qrcode（浏览器 classic script 下即 window.qrcode）。 */
  function vendor() {
    var q = (global && global.qrcode) ? global.qrcode : (typeof qrcode !== 'undefined' ? qrcode : null);
    if (!q || typeof q !== 'function') throw new Error('qrcode vendor 未加载');
    return q;
  }

  /**
   * 用 H 级纠错 + UTF-8 字节模式生成 QR 矩阵（版本自适应）。
   * @param {string} url 码内容
   * @returns {{qr: Object, M: number}}
   */
  function buildMatrix(url) {
    var q = vendor();
    if (q.stringToBytesFuncs && q.stringToBytesFuncs['UTF-8']) {
      q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
    }
    var inst = q(0, 'H');
    inst.addData(String(url), 'Byte');
    inst.make();
    return { qr: inst, M: inst.getModuleCount() };
  }

  /** 是否落在三个 7×7 finder pattern 区域（含其 separator 判定由 isDark 决定）。 */
  function isFinderRegion(r, c, M) {
    return (r < 7 && c < 7) || (r < 7 && c >= M - 7) || (r >= M - 7 && c < 7);
  }

  /**
   * QR 层：双层循环绘制全部模块。finder 区域画标准实心方块，其余深色模块画圆点。
   * 全程不裁切、不擦除、不改 globalCompositeOperation。
   */
  function drawModules(ctx, inst, M, ox, oy, u, forceSquare) {
    ctx.fillStyle = COSMIC_PALETTE.ink;
    for (var r = 0; r < M; r++) {
      for (var c = 0; c < M; c++) {
        if (!inst.isDark(r, c)) continue;
        var x = ox + (QUIET + c) * u;
        var y = oy + (QUIET + r) * u;
        if (forceSquare || isFinderRegion(r, c, M)) {
          ctx.fillRect(x, y, u, u);
        } else {
          ctx.beginPath();
          ctx.arc(x + u / 2, y + u / 2, 0.43 * u, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** 装饰同心圆环：画在 QR 层之前，位于圆形外圈带，低透明度，不覆盖任何模块。 */
  function drawDecorRings(ctx, cx, cy, R) {
    var angles = [-Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4];
    var rings = [
      { k: 0.86, w: 2, color: 'rgba(90,209,255,0.18)' },
      { k: 0.92, w: 2, color: 'rgba(196,181,253,0.16)' },
      { k: 0.98, w: 2, color: 'rgba(90,209,255,0.18)' }
    ];
    for (var i = 0; i < angles.length; i++) {
      for (var j = 0; j < rings.length; j++) {
        var g = rings[j];
        ctx.strokeStyle = g.color;
        ctx.lineWidth = g.w;
        ctx.beginPath();
        ctx.arc(cx, cy, R * g.k, angles[i] - 0.20, angles[i] + 0.20);
        ctx.stroke();
      }
    }
  }

  /** 确定性伪随机（固定种子），保证每次渲染的星空是同一帧、不闪烁。 */
  function makeRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /**
   * 中心星空盘：离屏 Canvas 2x 超采样静态一帧，用 destination-in 合成得到圆形，
   * 再 drawImage 缩小贴到中心。此合成只作用于离屏星空内容，绝不作用于 QR 层。
   */
  function drawStarfield(ctx, cx, cy, d) {
    var C = COSMIC_PALETTE;
    var S = Math.max(2, Math.round(d * 2));
    var off = global.document.createElement('canvas');
    off.width = S;
    off.height = S;
    var g = off.getContext('2d');
    var cc = S / 2;
    var rnd = makeRandom(20261106);

    // 1) 深蓝紫径向底
    var bg = g.createRadialGradient(cc, cc, 0, cc, cc, cc);
    bg.addColorStop(0, C.bg[0]);
    bg.addColorStop(0.6, C.bg[1]);
    bg.addColorStop(1, C.bg[2]);
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);

    // 2) 3 团星云
    g.globalCompositeOperation = 'lighter';
    var nebula = [
      { x: cc, y: cc, r: cc * 0.90, c: C.nebula[0], a: 0.07 },
      { x: cc + cc * 0.32, y: cc + cc * 0.12, r: cc * 0.80, c: C.nebula[1], a: 0.06 },
      { x: cc - cc * 0.36, y: cc - cc * 0.22, r: cc * 0.72, c: C.nebula[2], a: 0.05 }
    ];
    for (var n = 0; n < nebula.length; n++) {
      var nb = nebula[n];
      var ng = g.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r);
      ng.addColorStop(0, 'rgba(' + nb.c + ',' + nb.a + ')');
      ng.addColorStop(1, 'rgba(' + nb.c + ',0)');
      g.fillStyle = ng;
      g.beginPath(); g.arc(nb.x, nb.y, nb.r, 0, Math.PI * 2); g.fill();
    }

    // 3) 金色星系核
    var cg = g.createRadialGradient(cc, cc, 0, cc, cc, cc * 0.42);
    cg.addColorStop(0, 'rgba(' + C.gold[0] + ',0.55)');
    cg.addColorStop(0.45, 'rgba(' + C.gold[1] + ',0.18)');
    cg.addColorStop(1, 'rgba(' + C.gold[1] + ',0)');
    g.fillStyle = cg;
    g.beginPath(); g.arc(cc, cc, cc * 0.42, 0, Math.PI * 2); g.fill();

    // 4) 3 臂螺旋星点
    var arms = 3;
    for (var i = 0; i < 220; i++) {
      var arm = i % arms;
      var t = Math.pow(rnd(), 0.6);
      var radius = t * cc * 0.94;
      var spread = (rnd() - 0.5) * 0.55 * (1 - t * 0.5);
      var ang = arm * (Math.PI * 2 / arms) + t * Math.PI * 2 * 1.6 + spread + (rnd() - 0.5) * 0.25;
      // 星点 rgb 三元组字面量与 cosmic-bg.js L24 一致
      var col = t < 0.15 ? '255,228,150' : (t < 0.5 ? '205,175,255' : '120,170,255');
      var px = cc + Math.cos(ang) * radius;
      var py = cc + Math.sin(ang) * radius * 0.82;
      g.globalAlpha = rnd() * 0.5 + 0.3;
      g.fillStyle = 'rgb(' + col + ')';
      g.beginPath(); g.arc(px, py, rnd() * 1.1 + 0.3, 0, Math.PI * 2); g.fill();
    }

    // 5) 白 / 青 / 紫星点 60 颗，1–2 颗亮星带光晕
    g.globalAlpha = 1;
    for (var s = 0; s < 60; s++) {
      var tint = rnd();
      var hue = tint < 0.16 ? C.cyan : (tint < 0.30 ? C.purple : C.white);
      var sx = rnd() * S, sy = rnd() * S;
      var sr = rnd() * 1.2 + 0.4;
      g.globalAlpha = rnd() * 0.6 + 0.4;
      g.fillStyle = hue;
      g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
      if (sr > 1.3) {
        g.globalAlpha = 0.22;
        g.beginPath(); g.arc(sx, sy, sr * 2.6, 0, Math.PI * 2); g.fill();
      }
    }

    // 6) 1 条短流星
    g.globalAlpha = 1;
    var mx = cc * 0.55, my = cc * 0.40;
    var mg = g.createLinearGradient(mx, my, mx + cc * 0.45, my + cc * 0.22);
    mg.addColorStop(0, 'rgba(255,255,255,0)');
    mg.addColorStop(1, 'rgba(255,255,255,0.85)');
    g.strokeStyle = mg;
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + cc * 0.45, my + cc * 0.22); g.stroke();

    // 把离屏方形内容合成为圆形（destination-in，非裁切调用），四角变透明
    g.globalCompositeOperation = 'destination-in';
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(cc, cc, cc, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';

    ctx.drawImage(off, cx - d / 2, cy - d / 2, d, d);
  }

  /** 圆形描边（青蓝 → 紫渐变）+ 4 个小刻度。 */
  function drawCircleFrame(ctx, cx, cy, R) {
    var grad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    grad.addColorStop(0, '#5ad1ff');
    grad.addColorStop(1, '#8b7bff');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(90,209,255,0.65)';
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * (R - 1), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 渲染到 canvas。
   * @param {HTMLCanvasElement} canvas
   * @param {string} url 码内容（ShareUrl.makeShareUrl 的返回值）
   * @param {{size?: number, plain?: boolean}} [opts] size 默认 800；plain 默认 false
   */
  function render(canvas, url, opts) {
    opts = opts || {};
    var SIZE = Number(opts.size) > 0 ? Math.floor(Number(opts.size)) : 800;
    var plain = opts.plain === true;
    var ctx = canvas.getContext('2d');
    canvas.width = SIZE;
    canvas.height = SIZE;

    var built = buildMatrix(url);
    var M = built.M;
    var inst = built.qr;
    var G = M + 2 * QUIET;
    var cx = SIZE / 2, cy = SIZE / 2;

    ctx.clearRect(0, 0, SIZE, SIZE);

    if (plain) {
      // 回退：纯黑白标准 QR + 4 模块静区，白底整张，全部模块实心方块
      var uPlain = Math.max(1, Math.floor((SIZE - 2 * PAD) / G));
      var LPlain = uPlain * G;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, SIZE, SIZE);
      drawModules(ctx, inst, M, Math.round(cx - LPlain / 2), Math.round(cy - LPlain / 2), uPlain, true);
      return;
    }

    // 方阵内接于圆：√2·L ≤ SIZE − 2·PAD，四角不裁
    var u = Math.max(1, Math.floor((SIZE - 2 * PAD) / (G * Math.SQRT2)));
    var L = u * G;
    var R = L / Math.SQRT2;
    var ox = Math.round(cx - L / 2), oy = Math.round(cy - L / 2);

    // 1) 白色圆形底（圆外保持透明，便于贴到深色海报）
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // 2) 装饰同心圆环（QR 层之下）
    drawDecorRings(ctx, cx, cy, R);

    // 3) QR 层（全模块 + 标准 finder，无裁切）
    drawModules(ctx, inst, M, ox, oy, u, false);

    // 4) 中心白晕（直径 0.20L + 1 模块，实际遮挡面积远小于 H 级 30% 容错）
    var d = 0.20 * L;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx, cy, d / 2 + u, 0, Math.PI * 2); ctx.fill();

    // 5) 中心星空图（离屏静态一帧）
    drawStarfield(ctx, cx, cy, d);

    // 6) 圆形描边
    drawCircleFrame(ctx, cx, cy, R);
  }

  /** 导出 PNG（供 admin.js 下载，不发起网络请求）。 */
  function toDataURL(canvas) {
    return canvas.toDataURL('image/png');
  }

  global.LotteryQR = {
    COSMIC_PALETTE: COSMIC_PALETTE,
    buildMatrix: buildMatrix,
    render: render,
    toDataURL: toDataURL
  };
})(typeof window !== 'undefined' ? window : this);
