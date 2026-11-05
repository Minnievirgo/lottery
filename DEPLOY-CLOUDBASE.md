# 抽签系统 · CloudBase 免费部署指南（0 元）

> ## ⚠️ 当前未采用（2026-11-05 起改回 Render + Turso）
> 境外网站已恢复正常访问，主推方案回到 [DEPLOY.md 第 1 节](./DEPLOY.md)。
> 本文与 `cloudbase/` 目录作为**国内 0 元备选**完整保留，代码已通过全量回归，随时可切换；
> 不影响 Render 部署（Dockerfile 不会打包这些文件）。以下为备选方案原文。
>
> **适用**：想长期反复用、微信里能直接点开、电脑可以关、链接固定，且**打不开境外网站**。
> 全程只访问 `cloud.tencent.com` / `tcb.cloud.tencent.com`（国内实测 200 可达），
> **不需要** GitHub、Turso、Render，也不需要买服务器或域名。

---

## 0. 先看清这套方案给什么、限制是什么

**给你**：¥0/月、免备案自带 HTTPS 的固定域名、全托管（电脑可关）、微信可直接打开、数据存云端。

**限制（务必先接受再动手）**：

| 项 | 说明 |
|---|---|
| 免费额度 | 每账号 **1 个免费环境**，**3,000 资源点/月**（1,000 点 ≈ ¥1） |
| 有效期 | **单次 6 个月**，到期前 1 个月内手动续期，**不支持自动续费**。建议日历提醒 |
| 兑换码 | 自 2026-01-16 起，免费环境需用**一次性兑换码**创建（购买页领取） |
| 超限行为 | FREE **不支持加购资源包 / 按量付费** → 好处是**不会意外扣钱**；坏处是额度用尽可能限流/停服，请设用量告警 |
| 功能限制 | 官方原文："免费环境存在一些功能使用限制"；如某能力被限制，可在控制台转付费环境 |
| 小程序条款 | 官方有"免费环境在**小程序发布**后到期时间变为上线后第 15 天"的条款；**我们是 Web 网页应用，不发布小程序，不受该条约束**，但免费政策可能调整，留意腾讯云通知 |
| 域名 | 用平台分配的**默认域名**即可；绑自己的域名走大陆节点要备案，反而多事 |

> 如果这些限制不能接受，走 [DEPLOY.md 第 3 节「香港服务器」](./DEPLOY.md)（约 55 元/月，最稳、数据完全自己掌握）。

### 架构（为什么这么搭）

```
用户微信 / 浏览器
   │  https://<默认域名>/
   ▼
CloudBase HTTP 访问服务（路径映射）
   ├── /           → 静态网站托管（index.html / admin / CSS / JS）
   ├── /api/*      → 普通云函数 lottery-api
   └── /d/*        → 普通云函数 lottery-api（短链 302）
                          │
                          ▼
                  @cloudbase/node-sdk
                          │
                          ▼
              文档数据库（draws / results / participants）
```

**两个关键技术决策**（都已查证，别改回去）：

1. **不用「云托管」容器**。官方资源点计费表：云托管 CPU 55 点/(核·小时) + 内存 32 点/(GB·小时)，按 0.5 核 0.5G 常驻约 **3.1 万点/月**，是免费额度的 10 倍，一天就烧光。必须用**按调用计费的云函数**（闲时 0 消耗，3,000 点约够 40 万次请求）。
2. **不用 PostgreSQL 直连**。官方社区明确回复：个人版/免费版环境下 PG 的 TCP 直连走不通（内网互联不支持、公网直连开关开不了）。因此数据层改用**文档数据库 + node-sdk**（SDK 走平台内部 API，不走 TCP 直连；且支持 `runTransaction` 事务保证抽签不超发）。

---

## 1. 开通免费环境（约 5 分钟）

1. 注册 / 登录腾讯云并完成**实名认证**：https://cloud.tencent.com
2. 打开云开发控制台：https://tcb.cloud.tencent.com/dev
3. 点「**免费试用**」→ 使用购买页领取的**一次性兑换码**创建免费体验版环境
4. **地域选「上海」**，数据库类型选「**云数据库（文档型，默认）**」
   - ⚠️ 不要选 PostgreSQL：免费版 TCP 直连不通，且本项目数据层用的是文档数据库
5. 记下**环境 ID**（形如 `lottery-1a2b3c4d5e`），后面要用

## 2. 创建三个集合

控制台 → 数据库 → 新建集合，逐个建：

```
draws
results
participants
```

> 代码里也会 best-effort 自动创建，但官方建议手动建一次，避免首次读取报"集合不存在"。

## 3. 部署

### 方式 A：CLI（推荐，步骤少）

```bash
npm i -g @cloudbase/cli
tcb login                      # 浏览器授权，国内可访问
cd lottery
cp cloudbaserc.example.json cloudbaserc.json
# 编辑 cloudbaserc.json，把 envId 改成你的环境 ID
node build-cloudbase.js        # 生成 cloudbase/function/ 与 cloudbase/hosting/
cd cloudbase/function && npm install && cd ../..
tcb fn deploy lottery-api
tcb hosting deploy ./cloudbase/hosting /
```

> `cloudbaserc.json` 含环境 ID，**已加入 .gitignore，不要提交**。
> 若 CLI 子命令随版本报错，用 `tcb --help` 查当前写法，或改用下面的方式 B。

### 方式 B：控制台手工（不装 CLI 也能做）

1. `node build-cloudbase.js` 生成产物
2. 在 `cloudbase/function/` 里执行 `npm install`，然后把整个目录打成 zip
3. 控制台 → 云函数 → 新建 → **普通云函数（事件型）**，名称 `lottery-api`，运行时 Node.js，上传 zip
4. 控制台 → 静态网站托管 → 上传 `cloudbase/hosting/` 里的全部文件到根目录

### 云函数环境变量（控制台 → 函数配置 → 环境变量）

| 变量 | 值 | 说明 |
|---|---|---|
| `DB_DRIVER` | `cloudbase` | **必填**，切换到文档数据库数据层 |
| `ADMIN_PASSWORD` | 你自己的密码 | 不填则用代码默认值；**生产务必改成自己的** |

> ⚠️ **必须建成「普通云函数（事件型）」，不要建成「HTTP 云函数 / Web 函数」**。
> 官方文档：普通事件云函数环境**自动注入 SDK 凭证**，无需额外配置；
> 而 Web 云函数不注入 `TENCENTCLOUD_SECRETID/SECRETKEY`，必须显式配 `CLOUDBASE_APIKEY`，否则报 `getCredential failed`。

## 4. 配置 HTTP 访问服务（关键一步）

控制台 → 环境 → **HTTP 访问服务** → 添加路径映射：

| 路径 | 目标 | 作用 |
|---|---|---|
| `/` | 静态网站托管 | 用户页、后台、CSS/JS |
| `/api/*` | 云函数 `lottery-api` | 全部接口 |
| `/d/*` | 云函数 `lottery-api` | 短链 `/d/ID` → 302 到 `/?d=ID` |

配置完成后控制台会给出**默认域名**（形如 `https://xxx.tcloudbaseapp.com` 或 `https://xxx.app.tcloudbase.com`，以控制台显示为准）。

> `cloudbase/hosting/admin/index.html` 是构建脚本专门生成的，让 `/admin` 能直接命中目录索引；
> 若静态托管不自动索引目录，改用 `/admin.html`（也已在产物里）。

## 5. 迁移旧数据（可选）

1. 在旧系统后台点「**备份**」，下载完整备份 JSON（含全部抽签、结果项、参与名单）
2. 导入云端：

```bash
FORCE=1 CLOUDBASE_ENV_ID=你的环境ID node migrate-to-cloudbase.js 抽签系统完整备份-2026-11-05.json
```

> ⚠️ `importAll` 会**覆盖目标库全部数据**（先清空三个集合再写入），务必确认目标环境是新的。
> 需要 `FORCE=1` 才会执行，防止误操作。

## 6. 验收

| 检查 | 期望 |
|---|---|
| `https://<默认域名>/api/health` | `{"ok":true,"mode":"cloudbase"}` |
| `https://<默认域名>/` | 用户抽签页（宇宙星系背景） |
| `https://<默认域名>/admin` 或 `/admin.html` | 管理后台，用你设的密码登录 |
| 微信里发 `https://<默认域名>/?d=抽签ID` | 直接打开，无插页 |

后台登录后：新建抽签 → 点「复制链接」→ 把 `https://<默认域名>/?d=ID` 发给用户即可。

## 7. 资源点预算与用量告警

按官方计费表（上海地域）估算，小规模抽签活动（几十~几百人）远低于 3,000 点/月：

| 资源 | 单价 |
|---|---|
| 云函数调用 | 13.3 点/万次 |
| 云函数资源使用 | 0.11108 点/GB·s |
| 文档数据库调用 | 200 点/万次 |
| 文档数据库容量 | 40 点/GB/天 |
| HTTP 网关 | 30 点/万次 |
| 静态托管流量 | 210 点/GB |

控制台 → **套餐用量** → 开用量告警；别把链接公开发到会被刷的场合。

## 8. 每 6 个月续期（别忘）

控制台 → 环境 → 免费体验环境 → **续期**（仅到期前 1 个月内可续，一次续 6 个月）。
**不支持自动续费**，建议在日历里设两个提醒。到期未续会进入停服隔离期。

## 9. 本地验证（不需要云账号）

```bash
npm run test:all        # 一次跑完下面三套
npm test                # 本地 SQLite 数据层回归
npm run test:cloudbase  # CloudBase 数据层回归（内存 Mock，无需云环境）
npm run test:http       # HTTP 端到端回归（路由/鉴权/抽签/短链/静态页/备份恢复）
```

> 测试强制使用 `.tools/` 下的隔离数据库，**不会碰 `data/app.db` 的真实数据**。

## 10. 代码结构（本次为 CloudBase 新增的部分）

| 文件 | 作用 |
|---|---|
| `db-cloudbase.js` | 文档数据库数据层，与 `db.js` 导出同一组接口 |
| `cloudbase-mock.js` | `@cloudbase/node-sdk` 内存实现，供本地回归 |
| `cloudbase/function/index.js` | 云函数入口 |
| `cloudbase/function/http-bridge.js` | HTTP event ↔ Node req/res 桥接 |
| `build-cloudbase.js` | 生成云函数包 + 静态托管目录 |
| `migrate-to-cloudbase.js` | 备份 JSON → 云端导入 |
| `cloudbaserc.example.json` | CLI 配置模板 |
| `selftest-http.js` | 不监听端口的 HTTP 端到端回归 |
| `server.js` | 拆出可复用的 `handle(req,res)`；`DB_DRIVER` 切换数据层 |

**前端页面与用户分享链接完全没变**；本地 / 香港服务器 / Docker 方案也完全不受影响（`DB_DRIVER` 不设时走原来的 `db.js`）。

---

## 附：如果免费环境不够用

- 升级 Personal 版 ¥19.9/月（40,000 点/月，支持资源包与按量、余额告警、99.95% SLA）
- 或改走 [DEPLOY.md 第 3 节「香港服务器」](./DEPLOY.md)：`sudo bash deploy.sh 你的域名 你的管理密码`，数据落自己硬盘的 SQLite 单文件
