// http-bridge.js —— CloudBase「普通云函数 + HTTP 访问服务」与 server.js handle() 之间的桥接
//
// 为什么需要：CloudBase 普通云函数收到的是网关 event（httpMethod/path/headers/body），
// 而 server.js 的 handle(req,res) 期望 Node 原生 req/res。这里做双向转换。
// 同一份桥接也用于本地 selftest-http.js，在【不监听端口】的情况下跑完整 HTTP 回归。
const { Readable } = require('stream');

// 兼容不同资料里出现的字段名差异
function normalizeEvent(event) {
  event = event || {};
  const headers = event.headers || {};
  let method = event.httpMethod || event.method ||
    (event.requestContext && event.requestContext.httpMethod) || 'GET';
  method = String(method).toUpperCase();
  let pathname = event.path || event.rawPath ||
    (event.requestContext && event.requestContext.path) || '/';
  if (!pathname.startsWith('/')) pathname = '/' + pathname;

  const qs = event.queryStringParameters || event.queryString || event.query || {};
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (Array.isArray(v)) v.forEach(x => search.append(k, x == null ? '' : String(x)));
    else search.append(k, v == null ? '' : String(v));
  }
  const url = pathname + (search.toString() ? '?' + search.toString() : '');

  let body = event.body == null ? '' : event.body;
  if (event.isBase64Encoded && typeof body === 'string') body = Buffer.from(body, 'base64');
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) body = JSON.stringify(body);

  return { method, url, headers, body: body == null ? '' : body };
}

function makeReq({ method, url, headers, body }) {
  const chunks = body === '' || body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(String(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    headersSent: false,
    _chunks: [],
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
      this.headersSent = true;
      return this;
    },
    setHeader(k, v) { this.headers[k] = v; return this; },
    getHeader(k) { return this.headers[k]; },
    write(chunk) {
      this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk) {
      if (chunk != null) this.write(chunk);
      return this;
    },
    // 输出成 API 网关 / HTTP 访问服务要求的 {statusCode, headers, body}
    toResult() {
      const buf = Buffer.concat(this._chunks);
      const ct = String(this.headers['Content-Type'] || this.headers['content-type'] || '');
      const textual = ct === '' || /^(text\/|application\/(json|javascript|xml|csv)|image\/svg\+xml)/i.test(ct);
      return {
        statusCode: this.statusCode,
        headers: this.headers,
        body: textual ? buf.toString('utf8') : buf.toString('base64'),
        isBase64Encoded: !textual
      };
    }
  };
}

module.exports = { normalizeEvent, makeReq, makeRes };
