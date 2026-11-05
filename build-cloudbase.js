// build-cloudbase.js —— 生成 CloudBase 部署所需的两个产物目录
//
//   cloudbase/function/  : 云函数代码包（server.js / db-cloudbase.js / public 兜底 + 已有的入口文件）
//   cloudbase/hosting/   : 静态网站托管内容（含 /admin/index.html，使 /admin 可直接访问）
//
// 用法： node build-cloudbase.js
// 注意：脚本只重建上述产物，不会删除 cloudbase/function 里的 index.js / http-bridge.js / package.json。
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FN = path.join(ROOT, 'cloudbase', 'function');
const HOST = path.join(ROOT, 'cloudbase', 'hosting');
const PUBLIC = path.join(ROOT, 'public');

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('  +', path.relative(ROOT, dst));
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else copyFile(s, d);
  }
}

console.log('==> 1/3 云函数代码包 cloudbase/function/');
fs.mkdirSync(FN, { recursive: true });
rmrf(path.join(FN, 'public'));
copyFile(path.join(ROOT, 'server.js'), path.join(FN, 'server.js'));
copyFile(path.join(ROOT, 'db-cloudbase.js'), path.join(FN, 'db-cloudbase.js'));
copyDir(PUBLIC, path.join(FN, 'public'));

console.log('==> 2/3 静态托管内容 cloudbase/hosting/');
rmrf(HOST);
copyDir(PUBLIC, HOST);
// /admin -> /admin/index.html（静态托管目录索引），保留 /admin.html 作为保底地址
copyFile(path.join(PUBLIC, 'admin.html'), path.join(HOST, 'admin', 'index.html'));
copyFile(path.join(PUBLIC, 'admin.html'), path.join(HOST, 'admin.html'));

console.log('==> 3/3 完成');
console.log(`
产物已生成：
  云函数目录 : ${FN}
  静态托管   : ${HOST}

下一步（详见 DEPLOY-CLOUDBASE.md）：
  1) 在云函数目录执行 npm install（或直接由 CLI 部署时安装依赖）
  2) tcb fn deploy lottery-api       # 部署普通云函数
  3) tcb hosting deploy ${HOST} /    # 上传静态资源
  4) 控制台配置 HTTP 访问服务：/api/* 与 /d/* -> lottery-api，/ -> 静态托管
`);
