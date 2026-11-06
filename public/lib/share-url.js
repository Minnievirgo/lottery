// public/lib/share-url.js —— 分享链接的唯一来源（UMD：Node + 浏览器）
//
// 卡片「复制链接」、二维码弹窗「复制链接」、二维码内容、弹窗链接文本、
// Node 单测全部调用同一个函数，由构造保证逐字符一致（AC-3.1 / AC-3.2）。
// 码内容仅由调用方传入的当前页面 origin 动态拼接，源码中不含任何域名常量，
// 因此线上正式域名确定后无需批量重出二维码（Q11 / R8）。
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

  /**
   * 构造某场抽签的分享链接：origin + '/?d=' + encodeURIComponent(drawId)。
   * 末尾斜杠会被去掉，避免生成 '//?d='。
   * @param {string} origin 当前页面 origin（由调用方传入，例如 location.origin）
   * @param {string} drawId 抽签 id（base64url，encodeURIComponent 后仍是安全字符）
   * @returns {string}
   */
  function makeShareUrl(origin, drawId) {
    var base = String(origin == null ? '' : origin).replace(/\/+$/, '');
    var id = String(drawId == null ? '' : drawId);
    return base + '/?d=' + encodeURIComponent(id);
  }

  return { makeShareUrl: makeShareUrl };
}));
