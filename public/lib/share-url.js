// public/lib/share-url.js —— 分享链接的唯一来源（UMD：Node + 浏览器）
//
// 卡片「复制链接」、二维码弹窗「复制链接」、二维码内容、弹窗链接文本、
// Node 单测全部调用同一个函数，由构造保证逐字符一致（AC-3.1 / AC-3.2）。
// 码内容默认仅由调用方传入的当前页面 origin 动态拼接，源码中不含任何域名常量，
// 因此线上正式域名确定后无需批量重出二维码（Q11 / R8）。
//
// v9（2026-11-07）短正式域名：QR 版本由 URL 长度决定 —— 域名越短，码点越少。
//   长线上域名 44 字符 → H 级 37×37；短正式域名 23 字符 → 29×29，码点再少约 38%。
//   域名仍不硬编码，两条路径任选其一：
//     ① 直接用短正式域名打开后台，location.origin 自动就是短域名，零配置生效；
//     ② 后台仍从长域名访问时，在 admin.html 顶部预置 window.LOTTERY_SHARE_ORIGIN，
//        或调用 setShareOrigin()，之后复制链接 / 二维码 / 弹窗文本全部改短且仍逐字符一致。
//   未配置（默认）时行为与 v8 完全相同，零回归；留空字符串等同未配置。
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ShareUrl = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  var configured = null;

  /** 只接受完整的 http(s) origin；空串 / 相对路径 / 垃圾值一律视为「未配置」。 */
  function normalizeOrigin(v) {
    var s = String(v == null ? '' : v).trim().replace(/\/+$/, '');
    return (/^https?:\/\//i.test(s) && s.length > 9) ? s : null;
  }

  /** 注入短正式域名（部署侧配置入口）；传 null / 空串可清除。 */
  function setShareOrigin(origin) {
    configured = normalizeOrigin(origin);
    return configured;
  }
  function clearShareOrigin() { configured = null; }
  function getShareOrigin() { return configured; }

  /**
   * 构造某场抽签的分享链接：base + '?d=' + encodeURIComponent(drawId)。
   * v8（2026-11-07）：去掉 origin 与查询串之间的 '/' —— 浏览器会把
   * `origin?d=xxx` 规范化为对 `/?d=xxx` 的请求，HTTP 层完全等价，
   * 历史已发布的 `/?d=` 链接继续有效；但 URL 短 1 字符，恰好把 8 字符
   * drawId 的 H 级二维码从 41×41 降到 37×37（码点少约 18%，视觉更精简）。
   * v9：base 优先取 setShareOrigin() / 页面预置的短正式域名，否则沿用传入 origin。
   * @param {string} origin 当前页面 origin（由调用方传入，例如 location.origin）
   * @param {string} drawId 抽签 id（base64url，encodeURIComponent 后仍是安全字符）
   * @returns {string}
   */
  function makeShareUrl(origin, drawId) {
    var fallback = String(origin == null ? '' : origin).replace(/\/+$/, '');
    var preset = null;
    if (typeof globalThis !== 'undefined' && globalThis.LOTTERY_SHARE_ORIGIN) {
      preset = normalizeOrigin(globalThis.LOTTERY_SHARE_ORIGIN);
    }
    var base = configured || preset || fallback;
    var id = String(drawId == null ? '' : drawId);
    return base + '?d=' + encodeURIComponent(id);
  }

  return {
    makeShareUrl: makeShareUrl,
    setShareOrigin: setShareOrigin,
    clearShareOrigin: clearShareOrigin,
    getShareOrigin: getShareOrigin
  };
}));
