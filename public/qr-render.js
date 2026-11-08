// public/qr-render.js —— 星空主题分享二维码渲染（浏览器 IIFE，window.LotteryQR）
//
// 依赖 classic <script> 先加载的 public/vendor/qrcode.js（window.qrcode）。
// 与 public/cosmic-bg.js 完全独立：不引用、不修改它，不注册 resize / 动画循环。
//
// 视觉 v10「颜色统一」（主理人 2026-11-07：三个定位角是白色的，颜色不统一）：
//   底图 = 抽签系统动态背景（cosmic-bg.js：金核螺旋星系 + 星空）的确定性静态复刻；
//   ① 链接瘦身（v8 沿用）：ShareUrl 去掉 /?d= 的斜杠，URL 短 1 字符；
//   ② 短正式域名（v9）：码内容 = location.origin + '?d=' + id，域名越短 QR 版本越低——
//      长域名 44 字符 → H 级 37×37，短域名 23 字符 → 29×29，码点再少约 38%；
//      域名由部署侧绑定，源码不硬编码；也支持 ShareUrl.setShareOrigin() 注入短域名；
//   ③ 线条发光淡蓝（v9，最终定档沿用 v16）：数据模块 62% 淡蓝 + 两层极淡饱和蓝辉光（lighter 加色渐隐）；
//      v17 曾把辉光改金并通过全部可扫性验证，但主理人整图观感否决，故回退（见 ⑪）；
//      辉光外扩仅 0.12 / 0.264 模块（远小于 0.5，绝不触及相邻模块中心采样点）；
//   ④ 定位角颜色统一（v10）：数据线条与三个定位角共用唯一色源 INK_RGB，无「白色角」；
//      定位角区域先铺一层页面最暗底色 base2 的局部暗纱，再用同色淡蓝画标准 7×7 方形角。
//      原理：反色码「深 − 浅 = (ink − bg) × alpha」，bg 越暗明暗差越大，故压暗底色可在
//      **不提亮、不改色相**的前提下补足 finder 检测对比度。
//      实测：直接把定位角改成同色（无暗纱）→ 长域名 M=37 装饰版 jsQR 解码失败（3/4）；
//      加暗纱并把定位角 alpha 从 0.62 提到 0.75 补偿底色压暗 → 浏览器 4/4、色差仅 19、
//      角内对比 158（余量最大）。定位角保持标准方形：v9 实测圆角抗锯齿会让真实 Chrome
//      输出 jsQR 仅 1/3~2/4 可解；finder 也不得画外扩辉光（实测 M=37 挂）。
//   ⑤ 码区缩小（PAD 64）、背景粒子/星点各减半 → 四周星空更多、画面更透气；
//   ⑥ 线条加亮光（v11，主理人「二维码线条可以加点亮光吗」）：
//      辉光 alpha 0.12 → 0.16（外扩仍是 0.12 模块，远低于 0.15 硬上限），并新增「内高光」层
//      —— 只在暗模块满格方块内用 lighter 叠加 `rgba(150,210,255,0.16)`，绝不外扩。
//      与外扩辉光不同，内高光完全不触碰浅色模块：实测线条中心亮度 158→193（+22%），
//      而浅色模块亮度恒为 26、局部分离度 58→92（更抗噪），12 组浏览器扫描全部 4/4 可解。
//      定位角同步叠加同一层内高光，保持 v10 的颜色统一（角/线条亮度差 12→8）。
//   ⑦ 线条加亮光（v11，主理人「二维码线条可以加点亮光吗」）：
//      辉光 alpha 提到 0.20（外扩仍是 0.12 模块，远低于 0.15 硬上限），并新增「内高光」层
//      —— 只在暗模块满格方块内用 lighter 叠加淡蓝，绝不外扩。
//      与外扩辉光不同，内高光完全不触碰浅色模块：实测线条中心亮度 158→193（+22%），
//      而浅色模块亮度恒为 26、局部分离度 58→92（更抗噪），12 组浏览器扫描全部 4/4 可解。
//      定位角同步叠加同一层内高光，保持 v10 的颜色统一（角/线条亮度差 12→8）。
//   ⑧ 细亮蓝描边（v13，主理人纠正 v12 判读：「指的是线条边缘更亮、那种细亮蓝描边」）：
//      **删除 v12 的「全局柔光带」** —— 上一轮把参考图误读成「贯穿码区的一条光带」，
//      实测那条光带会把码区中部整片抬白、描边反而不突出，属于错误方向，整层移除。
//      改为「轮廓式细亮蓝描边」：只在暗模块与浅色模块交界的**内部边缘**画 1px 亮蓝细线。
//      * contour 模式：连通的码点块只描外轮廓，相邻暗模块之间不画线 → 不会退化成满屏网格；
//      * 纯整数矩形拼四条边（不用描边 API，避免 Canvas 半像素抗锯齿），Node 镜像可 1:1 复刻；
//      * 描边完全落在模块内部，绝不外扩 → 不触碰浅色模块中心采样区，浅模块亮度恒 26；
//      * 遍历全部暗模块（含 finder：矩阵在 finder 区的 isDark 恰是外环 + 中心 3×3，
//        与 drawFinderInk 的 evenodd 形状一致），三个角与线条同步获得亮边、颜色统一；
//      * 描边色比线条更饱和（120,190,255），避免 lighter 叠加推成纯白；
//        实测亮边差 18（边缘 215 / 中心 197）、最差 gap 95、线条-角亮度差仅 5。
//      21 变体 × 4 URL 真实 Chrome 扫描的否决路径（勿重复踩）：
//      * 描边宽度 ≥2px、或「每个模块四边都画」的网格描边 → long41 装饰版解码失败（3/4、
//        最差 1/4）；只有 contour + 1px 稳定 4/4；
//      * 用 source-over 直接覆盖亮蓝 → 亮边差只剩 8~10，描边几乎看不见；
//      * 削掉 v11 内高光想让描边更突出 → 整体亮度下降、long41 挂（3/4）。
//
//   ⑨ 中心圆形镂空（v14）+ 边缘羽化（v15，主理人「镂空边缘羽化模糊一些，现在有点生硬」）：
//      在 render 开头把纯背景快照为 ImageData，末尾把圆内像素按渐变权重还原为纯背景
//      —— 圆内没有二维码、没有辉光/描边，就是同一张星空的延续（含金核光晕与星点）。
//      * 半径 = HOLE_FRAC × M × u（码区边长的 20%）：M*u 近似恒定，故 29/37/41/49 各版本
//        的物理圆大小一致（约 104~108px），不会因版本升高而缩水；
//      * 纯逐像素运算（不用 clip / 渐变 / 描边 API），无 Canvas 抗锯齿分歧，
//        Node 逐像素镜像可 1:1 复刻；
//      * v14 的 1px 软过渡在整图里等于硬切断（放大可见码点被整齐切掉）。v15 改为
//        **向内** HOLE_FEATHER = 24px 的 smoothstep 羽化带：码点由圆外向圆内逐渐淡出，
//        圆外像素严格零改变（不扩大连续 erasure 范围），风险低于双向 / 向外羽化；
//        13 组羽化变体 × 4 URL 全 4/4，in24 / in32 / sym24 / in40 四组再 × 15 随机 drawId
//        全 15/15；双向 24、向内 32 / 40 也可解，但圆轮廓开始发糊，留作备选档。
//      * 圆内暗模块被擦成背景 = 连续突发 erasure，靠 H 级 Reed-Solomon 纠错兜住。
//        实测边界：0.16 / 0.18 / 0.20 跨 15 个随机 drawId 全 15/15，0.22 挂 1/15、
//        0.24 挂 short29；按模块数定义时 R≤6 全过、R≥7 挂 short29。**定档 0.20 已接近
//        纠错上限，真机若不过优先下调到 0.18 或 opts.hole:false，切勿上调。**
//      * plain:true 回退分支提前 return，不镂空（标准黑白码不承担额外 erasure）。
//      * opts.hole:false 可只关闭镂空、保留全部 v13 视觉，作为真机兜底的第二级开关。
//
//   ⑩ 星点色系统一（v16，主理人「二维码上有些绿色的点光，改成黄色或紫色，保持和圆里的星光颜色一致」）：
//      实测 v15 成品有约 141 个孤立青绿点，来自星空层 tint<0.16 的青色首色（页面同源值）——
//      青蓝在深蓝底上视觉偏绿；而中心圆内（纯背景快照）的星光是金核旋臂的**金黄点** +
//      starViolet **紫点** + 白点，两者色系对不上。
//      * 星空层首色由青改金：starGold = #ffe496（即 armGold 255,228,150 / 金核光晕同色），
//        三色变为「金 / 紫 / 白」，比例沿用 16% / 14% / 70%，与圆内星光完全同源；
//      * 只改一个色值常量 + 一行取色表达式：星点位置、半径、alpha、光晕、中心守卫全部不变，
//        且这些点本就避开模块中心采样区，改色不改变明暗极性；
//      * 页面动态背景 cosmic-bg.js 保持原样（青 / 紫 / 白）——本文件是独立的静态导出图，
//        不动用户正在使用的抽签页面；二维码线条/描边色也不变（v13 定档的细亮蓝）。
//      * 5 变体 × 4 URL 真实 Chrome 扫描（v15 基线 / 纯金 / 纯紫 / 金8紫22 / 金24紫16）全 4/4，
//        放大特写逐组比对后定档 gold16；金色点亮度高于青点，15 随机 drawId 复核 15/15。
//
//   ⑪ 最终定档 = v16 视觉（主理人 2026-11-07 定稿：「改了好像不太好看，最终版就用这张吧」）：
//      v17 曾按圈图把「码区内部、方块交叉处的青绿十字亮斑」改金 —— 分关层诊断证明这些亮斑
//      100% 来自双层外扩辉光矩形在相邻暗模块交界处的 lighter 叠加，唯一起因是 GLOW_RGB；
//      改金后 10 变体 × 4 URL 40/40、15 随机 drawId 15/15、青绿像素归零、gap 115→123，
//      技术上完全成立，但主理人整图观感否决，最终以 **v16 成品图** 定稿交付。
//      * GLOW_RGB 回退为 v9 饱和蓝（96,178,255），v16 的金 / 紫 / 白星点全部保留，
//        v13 描边、v11 内高光、镂空羽化、页面动态背景一律不变；
//      * 保留诊断结论备用：将来若要处理十字亮斑，唯一着色点就是 GLOW_RGB，
//        不要去动细亮蓝描边（关描边对青绿像素毫无影响）；
//      * 交付物 .tools/qr-FINAL.png 即 v16 成品，产品输出须与其 PNG SHA-256 一致。
//
// 可扫性命门（改参数前必读）：
//   * 背景粒子/星点是「亮点」，若落在任何模块的中心采样区，会把该模块点亮/翻极性
//     → 所有粒子与星点按光晕触达范围确定性重采样避开（makeCenterGuard v3）；
//   * 反色码的码点必须满格、不能内缩留缝：jsQR 要求模块连续，实测任何 INSET>0 都会
//     让装饰版解码全挂（历史上圆点方案同因失败）——「笔画变细」是死路，只能靠缩短链接减少码点数量；
//   * 纠错等级必须保持 H：实测降 M/L 后装饰版 0/3~1/3（低纠错扛不住星空背景采样噪声）；
//   * 金核光晕为平滑渐变，局部阈值可跟随，无需规避；
//   * plain:true 一步回退「纯黑白标准 QR + 4 模块白静区」，真机解码失败时兜底。
//
// 设计 §7.4 色值约定：本文件自带 COSMIC_PALETTE（与 cosmic-bg.js / user.css 同源；
// 最终定档 v16 的唯一差异：导出图的星点首色由青改金，页面动态背景保持原样，详见 ⑩ / ⑪）。
(function (global) {
  'use strict';

  // v10 颜色统一：数据线条 / 定位角共用唯一 RGB 色源，杜绝「三个白色定位角」回归。
  // 定位角 alpha 较高只是补偿下方局部暗纱压暗的底色：最终像素与数据线条色差仅 19（实测），
  // 而 v9 的近白不透明定位角与线条色差高达 153、亮度差 91 —— 即本次要修的「三个白角」。
  var INK_RGB = '198,230,255';                       // 唯一色源：发光淡蓝
  var CODE_INK = 'rgba(' + INK_RGB + ',0.62)';       // 数据模块：62% 淡蓝
  var FINDER_INK = 'rgba(' + INK_RGB + ',0.75)';     // 定位角：同色，alpha 补偿局部暗纱
  var FINDER_SHADE = 'rgba(2,3,10,0.55)';            // 定位角局部暗纱 = 页面最暗底色 base2
  // 最终定档 v16：辉光沿用 v9 饱和蓝（v17 改金试作已按主理人定稿回退，见文件头 ⑪）。
  // 只换色值，alpha 与两层外扩不变；方块交叉处的青蓝十字高光是 v16 定稿视觉的一部分。
  var GLOW_RGB = '96,178,255';
  var GLOW_A = 0.20;                         // v13：0.16→0.20（外扩不变，配合描边增强发光感）
  var GLOW_PAD = 0.12;                       // 内层外扩（模块数）；外层 = 2.2 倍 = 0.264
  // v11 内高光：只在暗模块「内部」加色、不外扩。与辉光互补——辉光染边缘、内高光抬主体，
  // 且因不触碰浅色模块，亮度提升的同时局部分离度反而增大（实测 gap 58→92）。
  var SHEEN_RGB = '150,210,255';
  var SHEEN_A = 0.16;
  // v13 细亮蓝描边：轮廓式（只描暗/浅交界）、1px、纯整数矩形、lighter 加色、绝不外扩。
  // 色相比线条更饱和，避免 lighter 叠加把亮边推成纯白；t≥2 实测会让 long41 解码失败。
  var EDGE_RGB = '120,190,255';
  var EDGE_INK = 'rgba(' + EDGE_RGB + ',0.55)';
  var EDGE_T = 1;
  // v14 中心圆形镂空：半径 = HOLE_FRAC × 码区边长（M*u），各 QR 版本物理尺寸一致。
  // 0.20 是实测纠错边界内最大值（0.22 已开始挂），上调会让短域名版本解不出。
  var HOLE_FRAC = 0.20;
  // v15 边缘羽化：向内 HOLE_FEATHER 像素的 smoothstep 渐变带，圆外严格零改变。
  // 24px 实测 4 URL 4/4、15 随机 drawId 15/15；32/40px 也可解但圆轮廓发糊。
  var HOLE_FEATHER = 24;

  var COSMIC_PALETTE = {                     // 与 cosmic-bg.js / user.css 同源（星点首色见 ⑩）
    base0: '#11173a', base1: '#0a0f24', base2: '#02030a',
    armGold: '255,228,150', armViolet: '205,175,255', armBlue: '120,170,255',
    nebA: '150,130,255', nebB: '90,160,255', nebC: '120,90,220',
    coreGlow: '255,238,185', coreGlow2: '255,212,140',
    // v16：金 / 紫 / 白三色。starGold = armGold(255,228,150) / 金核光晕同色，
    // 即中心圆里那批金黄小星光；不再用视觉偏绿的青色星点（页面动态背景仍保留青色）。
    starGold: '#ffe496', starViolet: '#c4b5fd', starWhite: '#ffffff'
  };

  var QUIET = 4;              // 静区 ≥ 4 模块（Q7）
  var PAD = 64;               // v8 码区缩小，四周留更多星空（实测 24~80 均可扫）

  /** 是否落在三个 7×7 finder pattern 区域。 */
  function isFinderRegion(r, c, M) {
    return (r < 7 && c < 7) || (r < 7 && c >= M - 7) || (r >= M - 7 && c < 7);
  }

  /** 确定性伪随机（固定种子），保证每次渲染的星空是同一帧、不闪烁。 */
  function makeRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

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

  /**
   * 背景粒子/星点守卫 v3（光晕感知）：光晕是均匀 alpha 实心圆，会从落点向外延伸
   * haloR 像素——只避中心盒或固定 reach 都挡不住「边缘星点的光晕贴脸」。
   * 故按每个点自己的光晕半径计算：距任何模块中心 < haloR+1px 即拒绝并重采样。
   * 依据实测：光晕贴中心时浅色模块被抬亮、局部分离仅 15（M41/M49 临界）；
   * 守卫生效后局部分离最差 gap 提升一倍以上，且拒绝率 <25%、星系观感无损。
   */
  function makeCenterGuard(M, ox, oy, u) {
    return function (x, y, haloR) {
      var need = (haloR || 0) + 1, need2 = need * need;
      var c = Math.round((x - ox) / u - QUIET - 0.5);
      var r = Math.round((y - oy) / u - QUIET - 0.5);
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= M || cc >= M) continue;
          var dx = x - (ox + (QUIET + cc + 0.5) * u);
          var dy = y - (oy + (QUIET + rr + 0.5) * u);
          if (dx * dx + dy * dy < need2) return false;
        }
      }
      return true;
    };
  }

  /** 采样一个被守卫接受的点（确定性：整组随机数重抽，序列仍固定）。 */
  function guardedPoint(rnd, guard, place) {
    var p;
    for (var tries = 0; tries < 40; tries++) {
      p = place(rnd);
      if (guard(p.x, p.y, p.haloR)) return p;
    }
    return p;   // 40 次仍被拒（几乎不可能）就放行最后一次
  }

  /**
   * 动态背景复刻（v7）：cosmic-bg.js 金核螺旋星系 + 星空的单帧确定性版本。
   * 与原版差异：Math.random → 种子随机；无旋转相位/流星（静态帧）；
   * 粒子与星点经中心守卫避开模块采样区。
   */
  function drawCosmicBg(ctx, SIZE, guard) {
    var C = COSMIC_PALETTE;
    var cx = SIZE / 2, cy = SIZE * 0.4, R = Math.max(SIZE, SIZE) * 0.62;
    var rnd = makeRandom(20261106);

    // 1) 页面同款径向底色（radial-gradient(130% 100% at 50% 0%) 的椭圆复刻）
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(1.3, 1);
    var bg = ctx.createRadialGradient(0, 0, 0, 0, 0, SIZE);
    bg.addColorStop(0, C.base0);
    bg.addColorStop(0.45, C.base1);
    bg.addColorStop(1, C.base2);
    ctx.fillStyle = bg;
    ctx.fillRect(-cx / 1.3, 0, SIZE / 1.3, SIZE);
    ctx.restore();

    // 2) 星云 ×3（lighter 叠加，同 cosmic-bg.js 参数）
    ctx.globalCompositeOperation = 'lighter';
    var nebulas = [
      [cx, cy, R * 0.5, C.nebA, 0.07],
      [cx + R * 0.22, cy + R * 0.08, R * 0.45, C.nebB, 0.06],
      [cx - R * 0.25, cy - R * 0.15, R * 0.4, C.nebC, 0.05]
    ];
    for (var ni = 0; ni < nebulas.length; ni++) {
      var n = nebulas[ni];
      var ng = ctx.createRadialGradient(n[0], n[1], 0, n[0], n[1], n[2]);
      ng.addColorStop(0, 'rgba(' + n[3] + ',' + n[4] + ')');
      ng.addColorStop(1, 'rgba(' + n[3] + ',0)');
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.arc(n[0], n[1], n[2], 0, 6.28); ctx.fill();
    }

    // 3) 金核光晕（v7 微调：比 cosmic-bg.js 更大更柔——半径 0.30R、alpha 0.45。
    //    原版 0.22R/0.55 的陡峭渐变会在核心边缘 1 个模块内抬亮 ~55 亮度，
    //    浅色模块（透背景）比白线条模块涨得快，局部对比度被吃掉（实测 gap 仅 15）。
    //    放大半径降低坡度后 gap 恢复 >25，视觉上核心更柔和不抢码。）
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.30);
    cg.addColorStop(0, 'rgba(' + C.coreGlow + ',0.45)');
    cg.addColorStop(0.45, 'rgba(' + C.coreGlow2 + ',0.15)');
    cg.addColorStop(1, 'rgba(' + C.coreGlow2 + ',0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, 6.28); ctx.fill();

    // 4) 旋臂粒子 ×1500（3 臂，同 cosmic-bg.js 分布；rot 固定 0 = 静态帧）
    var arms = 3, N = 750;          // v8 粒子减半：背景更干净
    for (var i = 0; i < N; i++) {
      var arm = i % arms;
      var p = guardedPoint(rnd, guard, function (rn) {
        var t = Math.pow(rn(), 0.6);
        var radius = t * R * (0.96 + rn() * 0.08);
        var spread = (rn() - 0.5) * 0.55 * (1 - t * 0.5);
        var ang = arm * (Math.PI * 2 / arms) + t * Math.PI * 2 * 1.6 + spread + (rn() - 0.5) * 0.25;
        var col = t < 0.15 ? C.armGold : (t < 0.5 ? C.armViolet : C.armBlue);
        var pr = rn() * 1.3 + 0.3;
        return {
          x: cx + Math.cos(ang) * radius, y: cy + Math.sin(ang) * radius * 0.82,
          col: col, r: pr, a: rn() * 0.5 + 0.3,
          haloR: pr > 1.1 ? pr * 2.4 : 0
        };
      });
      ctx.globalAlpha = p.a;
      ctx.fillStyle = 'rgb(' + p.col + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
      if (p.r > 1.1) {
        ctx.globalAlpha = p.a * 0.25;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.4, 0, 6.28); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // 5) 星空层（source-over，同 cosmic-bg.js 分布；v16 首色青 → 金，与圆内星光一致）
    var count = Math.max(120, Math.round((SIZE * SIZE) / 11000));   // v8 星点减半
    for (var si = 0; si < count; si++) {
      var tint = rnd();
      var hue = tint < 0.16 ? C.starGold : (tint < 0.30 ? C.starViolet : C.starWhite);
      var s = guardedPoint(rnd, guard, function (rn) {
        var sr = rn() * 1.4 + 0.3;
        return { x: rn() * SIZE, y: rn() * SIZE, r: sr, a: rn() * 0.6 + 0.3,
                 haloR: sr > 1.1 ? sr * 2.6 : 0 };
      });
      ctx.globalAlpha = s.a;
      ctx.fillStyle = hue;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      if (s.r > 1.1) {
        ctx.globalAlpha = s.a * 0.25;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 定位角（v10）：标准 7×7 方形外环（evenodd 挖掉 5×5 内环透暗纱背景）+ 中心 3×3。
   * 颜色 = 与数据线条同一 RGB 色源（INK_RGB），仅 alpha 略高以补偿下方局部暗纱。
   * 不做圆角：真实 Chrome Canvas 的圆角抗锯齿与 Node 逐像素镜像存在几何差异，
   * 实测圆角版浏览器输出 jsQR 仅 1/3~2/4 可解，改回标准方形后 4/4；
   * finder 也不得画外扩辉光（实测同色 + finderGlow 会让 M=37 装饰版解码失败）。
   * finder 核心层不得外扩，否则破坏 1:1:3:1:1 比例。
   * v11：最后叠加与数据模块完全相同的内高光层（同一形状、lighter、不外扩），保持颜色统一。
   */
  function drawFinderInk(ctx, fx, fy, u) {
    var s = 7 * u;
    ctx.save();
    ctx.fillStyle = FINDER_INK;
    ctx.beginPath();
    ctx.rect(fx, fy, s, s);                     // 外环：标准方形，不圆角
    ctx.rect(fx + u, fy + u, 5 * u, 5 * u);    // 内环（透暗纱背景）
    ctx.fill('evenodd');
    ctx.fillRect(fx + 2 * u, fy + 2 * u, 3 * u, 3 * u);
    // v11 内高光：与数据模块同一色值/alpha，形状严格复用 finder 几何，绝不外扩
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + SHEEN_RGB + ',' + SHEEN_A + ')';
    ctx.beginPath();
    ctx.rect(fx, fy, s, s);
    ctx.rect(fx + u, fy + u, 5 * u, 5 * u);
    ctx.fill('evenodd');
    ctx.fillRect(fx + 2 * u, fy + 2 * u, 3 * u, 3 * u);
    ctx.restore();
  }

  /** plain 回退：白底 + 逐模块画满格实心黑色方块。 */
  function drawModules(ctx, inst, M, ox, oy, u) {
    ctx.fillStyle = COSMIC_PALETTE.base2;
    for (var r = 0; r < M; r++) {
      for (var c = 0; c < M; c++) {
        if (!inst.isDark(r, c)) continue;
        ctx.fillRect(ox + (QUIET + c) * u, oy + (QUIET + r) * u, u, u);
      }
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

    if (plain) {
      // 回退：纯黑白标准 QR + 4 模块静区，白底整张，全部模块实心方块
      ctx.clearRect(0, 0, SIZE, SIZE);
      var uPlain = Math.max(1, Math.floor((SIZE - 2 * PAD) / G));
      var LPlain = uPlain * G;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, SIZE, SIZE);
      drawModules(ctx, inst, M, Math.round(cx - LPlain / 2), Math.round(cy - LPlain / 2), uPlain);
      return;
    }

    var u = Math.max(1, Math.floor((SIZE - 2 * PAD) / G));
    var L = u * G;
    var ox = Math.round(cx - L / 2), oy = Math.round(cy - L / 2);
    var gx = ox + QUIET * u, gy = oy + QUIET * u;
    // 三个定位角左上角坐标（暗纱与 finder 绘制共用，保证几何完全一致）
    var fs = [[gx, gy], [gx + (M - 7) * u, gy], [gx, gy + (M - 7) * u]];

    // 1) 全画布动态背景复刻（含静区；粒子/星点避开模块中心采样区）
    drawCosmicBg(ctx, SIZE, makeCenterGuard(M, ox, oy, u));
    // v14：保存「纯背景」快照，末尾圆形镂空时用它把圆内像素还原为同一张星空。
    // 必须在任何二维码图层之前取，且 plain 分支已提前 return 不会走到这里。
    var bgSnap = opts.hole === false ? null : ctx.getImageData(0, 0, SIZE, SIZE);

    // 1.5) 定位角局部暗纱（v10 颜色统一的关键，详见文件头 ④）：
    //    只覆盖 7×7 finder 本身（不含 separator），用页面最暗底色 base2 压暗背景，
    //    随后在同一区域用「同色淡蓝」画 finder —— 不改色相即可补足检测对比度。
    //    反色码深 − 浅 = (ink − bg) × alpha，bg 越暗差值越大。
    ctx.save();
    ctx.fillStyle = FINDER_SHADE;
    for (var dsi = 0; dsi < fs.length; dsi++) {
      ctx.fillRect(fs[dsi][0], fs[dsi][1], 7 * u, 7 * u);
    }
    ctx.restore();

    // 2) 数据暗模块 → 淡蓝线条：先两层极淡饱和蓝辉光（v16 定档，lighter 加色渐隐），再盖满格实心核心块。
    //    坐标取整与 Node 验证脚本 rectAdd 一致（Math.round(x-pad)…Math.round(x+u+pad)），
    //    保证浏览器 Canvas 与逐像素镜像是同一张图，验收结论可迁移。
    var gp1 = GLOW_PAD * u, gp2 = GLOW_PAD * 2.2 * u;
    var glowRect = function (x, y, pad) {
      var x0 = Math.round(x - pad), y0 = Math.round(y - pad);
      var x1 = Math.round(x + u + pad), y1 = Math.round(y + u + pad);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + GLOW_RGB + ',' + (GLOW_A * 0.4) + ')';
    for (var gr = 0; gr < M; gr++) {
      for (var gc = 0; gc < M; gc++) {
        if (!inst.isDark(gr, gc) || isFinderRegion(gr, gc, M)) continue;
        glowRect(ox + (QUIET + gc) * u, oy + (QUIET + gr) * u, gp2);
      }
    }
    ctx.fillStyle = 'rgba(' + GLOW_RGB + ',' + GLOW_A + ')';
    for (var gr2 = 0; gr2 < M; gr2++) {
      for (var gc2 = 0; gc2 < M; gc2++) {
        if (!inst.isDark(gr2, gc2) || isFinderRegion(gr2, gc2, M)) continue;
        glowRect(ox + (QUIET + gc2) * u, oy + (QUIET + gr2) * u, gp1);
      }
    }
    ctx.restore();

    // 核心层：反色码不能留缝，jsQR 要求模块连续 —— 必须满格实心方块（定位角留给第 3 步）
    ctx.fillStyle = CODE_INK;
    for (var r = 0; r < M; r++) {
      for (var c = 0; c < M; c++) {
        if (!inst.isDark(r, c)) continue;
        if (isFinderRegion(r, c, M)) continue;
        ctx.fillRect(ox + (QUIET + c) * u, oy + (QUIET + r) * u, u, u);
      }
    }

    // 2.5) 内高光（v11）：只在暗模块满格方块内用 lighter 叠加淡蓝，绝不外扩。
    //     外扩辉光会抬亮相邻浅色模块边缘，内高光完全不会 —— 故线条变亮的同时局部分离度
    //     反而增大（实测 gap 58→92、浅模块亮度恒为 26）。定位角留给第 3 步同步叠加。
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + SHEEN_RGB + ',' + SHEEN_A + ')';
    for (var hr = 0; hr < M; hr++) {
      for (var hc = 0; hc < M; hc++) {
        if (!inst.isDark(hr, hc) || isFinderRegion(hr, hc, M)) continue;
        ctx.fillRect(ox + (QUIET + hc) * u, oy + (QUIET + hr) * u, u, u);
      }
    }
    ctx.restore();

    // 3) 三个定位角：同色淡蓝外环（evenodd 挖内环透暗纱背景）+ 同色中心 3×3
    for (var fi = 0; fi < fs.length; fi++) drawFinderInk(ctx, fs[fi][0], fs[fi][1], u);

    // 4) 细亮蓝描边（v13）：只在暗模块「与浅色相邻的内部边缘」画 1px 亮蓝细线。
    //    contour 模式 → 连通码点块只描外轮廓，相邻暗模块之间不画线（不会退化成满屏网格）；
    //    纯整数矩形拼四条边（不用描边 API，避免半像素抗锯齿），Node 逐像素镜像可 1:1 复刻；
    //    描边完全落在模块内部、绝不外扩 → 不触碰浅色模块中心采样区。
    //    遍历全部暗模块（含 finder，形状与 drawFinderInk 的 evenodd 一致），颜色统一不回退。
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = EDGE_INK;
    for (var ir = 0; ir < M; ir++) {
      for (var ic = 0; ic < M; ic++) {
        if (!inst.isDark(ir, ic)) continue;
        var ex = gx + ic * u, ey = gy + ir * u;
        var eUp = (ir === 0 || !inst.isDark(ir - 1, ic));
        var eDn = (ir === M - 1 || !inst.isDark(ir + 1, ic));
        var eLf = (ic === 0 || !inst.isDark(ir, ic - 1));
        var eRt = (ic === M - 1 || !inst.isDark(ir, ic + 1));
        if (eUp) ctx.fillRect(ex, ey, u, EDGE_T);
        if (eDn) ctx.fillRect(ex, ey + u - EDGE_T, u, EDGE_T);
        if (eLf) ctx.fillRect(ex, ey + EDGE_T, EDGE_T, u - 2 * EDGE_T);
        if (eRt) ctx.fillRect(ex + u - EDGE_T, ey + EDGE_T, EDGE_T, u - 2 * EDGE_T);
      }
    }
    ctx.restore();

    // 5) 中心圆形镂空（v15 羽化边缘）：圆内还原为纯背景星空，边缘 HOLE_FEATHER 像素
    //    由外向内逐渐淡出（smoothstep）。羽化带只向内展开 → 圆外像素严格零改变，
    //    不额外扩大连续 erasure；纯逐像素、无 clip / 渐变 / 描边 API，Node 镜像可 1:1 复刻。
    if (bgSnap) {
      var HR = HOLE_FRAC * M * u;
      var HIN = HR - HOLE_FEATHER, HOUT = HR;
      var hx0 = Math.max(0, Math.floor(cx - HOUT - 1)), hx1 = Math.min(SIZE, Math.ceil(cx + HOUT + 1));
      var hy0 = Math.max(0, Math.floor(cy - HOUT - 1)), hy1 = Math.min(SIZE, Math.ceil(cy + HOUT + 1));
      var hOut = ctx.getImageData(0, 0, SIZE, SIZE);
      var hb = bgSnap.data, ho = hOut.data;
      for (var hy = hy0; hy < hy1; hy++) {
        for (var hx = hx0; hx < hx1; hx++) {
          var hdx = hx + 0.5 - cx, hdy = hy + 0.5 - cy;
          var hd = Math.sqrt(hdx * hdx + hdy * hdy);
          if (hd >= HOUT) continue;
          var ht = (HOUT - hd) / (HOUT - HIN);
          if (ht > 1) ht = 1;
          var hw = ht * ht * (3 - 2 * ht);
          var hi = (hy * SIZE + hx) * 4;
          ho[hi]     = Math.round(hb[hi]     * hw + ho[hi]     * (1 - hw));
          ho[hi + 1] = Math.round(hb[hi + 1] * hw + ho[hi + 1] * (1 - hw));
          ho[hi + 2] = Math.round(hb[hi + 2] * hw + ho[hi + 2] * (1 - hw));
        }
      }
      ctx.putImageData(hOut, 0, 0);
    }
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
