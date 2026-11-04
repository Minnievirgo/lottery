# 抽签软件（Lottery App）

Node.js 实现的抽签系统：内置 `http` 服务 + 静态前端，数据层支持 **双后端**
（本地 `node:sqlite` / 云端 Turso libSQL）。包含面向用户的抽签页和管理后台，
前后台统一为「宇宙星系 · 浩瀚星空」动态背景风格。

> 部署与长期运行的完整说明见 **[DEPLOY.md](./DEPLOY.md)**（含香港服务器 / Render+Turso / 本机隧道三种方案）。

## 功能

- **管理后台**（密码保护）：创建 / 编辑多个抽签活动，可视化设置结果项（名称、数量上限、权重、颜色），开启 / 结束 / 删除，查看参与名单，统计，导出 Excel 兼容 CSV，一键复制分享链接，完整 JSON 备份 / 恢复。
- **发言顺序抽签**：输入数字 N，自动生成 `1~N` 共 N 个签，每签数量为 1。
- **用户抽签页**（移动优先）：点击分享链接进入指定抽签 → 输入姓名 → 抽签 → 结果揭晓 + 撒花动效；动态星系 / 星空 / 流星背景。
- **抽签逻辑（限量 + 随机混合）**：在「剩余 > 0 或 不限量」的结果项里按权重随机抽一个；限量项抽中后剩余 -1；全部限量抽完显示「已抽完」；开启防重复后同一姓名只回显其已抽结果，不重复消耗名额。
- **活动状态**：`open` / `closed`，关闭后不可再抽。

## 快速启动（本地）

需要 **Node.js ≥ 22.5**（内置 `node:sqlite`）。

```bash
cd lottery
npm install
npm start
```

启动后：

- 用户抽签页：http://localhost:3000/?d=抽签ID （短链 `/d/ID` 会重定向）
- 管理后台：http://localhost:3000/admin
- 健康检查：http://localhost:3000/api/health → `{"ok":true,"mode":"local"}`
- 默认管理员密码：`Tdsw2008`

### 修改管理员密码 / 端口

```bash
ADMIN_PASSWORD=你的密码 npm start
PORT=8080 npm start
```

> ⚠️ 生产环境务必通过 `ADMIN_PASSWORD` 环境变量改成自己的密码。

### 切换到 Turso 云端持久库

```bash
TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=eyJ... npm start
```

不配置这两个变量即用本地 SQLite（`data/app.db`）；配置后 `db.js` 自动切换为
`@libsql/client` 云端库。已有本地数据可用 `npm run migrate:turso` 迁移上云。

## 使用流程

1. 打开 `/admin`，用密码登录。
2. 点「新建抽签」：填标题、说明，勾选是否防重复，添加结果项（如「一等奖 ×1」「二等奖 ×3」「谢谢参与 不限量」），保存；也可用「发言顺序抽签」一键生成 `1~N`。
3. 在列表里点「复制链接」，把 `https://你的域名/?d=ID` 发给用户。
4. 用户打开链接 → 输入姓名 → 抽签。
5. 在后台可随时查看「名单」「统计」，或「导出 CSV」拿到 Excel 名单；「备份」按钮可导出全部数据 JSON。

## 部署

三种方案（详见 [DEPLOY.md](./DEPLOY.md)）：

| 方案 | 是否需要外网 | 费用 | 适合 |
|---|---|---|---|
| **香港服务器 + 域名（推荐）** | ❌ 不需要 | 约 55 元/月 + 域名 | 长期反复用、多人、微信分享 |
| Render + Turso | ✅ 需要登录境外网站 | 0 元 | 能顺畅访问 GitHub/Turso/Render 时 |
| 本机隧道 | ❌ 不需要 | 0 元 | 一次性临时活动 |

服务器上一键部署（自动装 Docker + Caddy + HTTPS 证书）：

```bash
sudo bash deploy.sh 你的域名 你的管理密码
```

数据落在宿主机 `./data`（Docker 持久卷），本地模式即 `data/app.db`，备份该文件即可；
后台「备份」按钮可导出含全部抽签与名单的 JSON。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | `Tdsw2008` | 管理后台密码，**生产务必改** |
| `TURSO_URL` | 空 | 设置后启用云端持久库 |
| `TURSO_TOKEN` | 空 | Turso auth token |
| `DATA_DIR` | `./data` | 仅本地模式有效 |
| `PORT` | `3000` | 监听端口 |

## 测试

```bash
npm test                              # 本地 SQLite 模式回归测试
TURSO_URL=file:./test.db npm test     # libSQL 模式回归测试（无需账号）
```

## 文件结构

```
lottery/
├── server.js              # HTTP 服务 + API 路由 + 管理员鉴权
├── db.js                  # 双后端数据层（建表、抽签事务、统计、导出、备份恢复）
├── public/
│   ├── index.html / user.css / user.js     # 用户抽签页
│   ├── admin.html / admin.css / admin.js   # 管理后台
│   └── cosmic-bg.js                       # 前后台共用动态星系 / 星空背景
├── data/                  # 本地 SQLite 数据库（自动生成，已 gitignore）
├── Dockerfile / docker-compose.yml        # 容器化部署（数据挂持久卷）
├── deploy.sh              # 服务器一键部署（Docker + Caddy 自动 HTTPS）
├── render.yaml            # Render Blueprint
├── deploy-remote.js       # Render + Turso 一键部署准备脚本
├── migrate-to-turso.js    # 本地数据迁移至 Turso
├── selftest.js            # 双后端回归测试
├── DEPLOY.md              # 部署与长期运行指南
└── start-tunnel.cmd       # Windows 本机临时公网隧道
```
