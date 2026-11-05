// CloudBase 云函数入口（普通事件型云函数，非 HTTP/Web 云函数）
//
// 部署类型必须是「普通云函数」+「HTTP 访问服务」路径映射：
//  - 普通云函数环境会自动注入 SDK 凭证，无需配置 CLOUDBASE_APIKEY；
//  - 若误建为「HTTP 云函数 / Web 函数」，官方要求额外配 CLOUDBASE_APIKEY，否则 getCredential failed。
//
// HTTP 访问服务路径建议配置：
//   /api/*  -> 本函数
//   /d/*    -> 本函数（短链 302）
//   /       -> 静态网站托管（页面 / CSS / JS）
const { normalizeEvent, makeReq, makeRes } = require('./http-bridge');
const { handle } = require('./server'); // 由 build-cloudbase.js 从项目根复制进来

exports.main = async (event) => {
  const input = normalizeEvent(event);
  const req = makeReq(input);
  const res = makeRes();
  try {
    await handle(req, res);
  } catch (e) {
    console.error('[lottery-api] handler error:', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'server_error', message: e.message }));
  }
  const r = res.toResult();
  return {
    statusCode: r.statusCode,
    headers: r.headers,
    body: r.body,
    isBase64Encoded: r.isBase64Encoded
  };
};
