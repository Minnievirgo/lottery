# 抽签系统 · 部署与长期运行指南

> 三种用法，按需选择：
> - **A. 长期反复用（推荐，0 元）** → 固定链接、电脑可关、数据永不丢。见第 1 节。
> - **B. 一次性活动（0 元，临时）** → 隧道，电脑要常开、链接会变。见第 2 节。
> - **C. 自己掌控服务器（约 55 元/月）** → 最稳、国内最快。见第 3 节。

---

## 1. ⭐ 长期反复用（推荐）：Render + Turso，0 元，固定链接

### 为什么不是"直接用 Render 免费实例"
实测查证（2026-11）：**Render 免费实例的文件系统在每次 redeploy、restart 和 spin-down 休眠时都会被清空**，
且免费实例**不能挂载持久磁盘**、闲置 15 分钟会休眠。直接把 SQLite 放本地 = 抽签名单随时会消失。

### 解法：计算与数据分离
| 层 | 服务 | 免费额度 | 作用 |
|---|---|---|---|
| 计算 | Render Free Web Service | 750 实例小时/月 | 跑 Node 服务，给固定 `https://<名字>.onrender.com` |
| 数据 | **Turso**（云端 SQLite） | **永久免费**：5GB、100 库、5 亿行读/月、无需信用卡 | 存全部抽签与名单，**与容器生命周期完全解耦** |

Turso 用的是 SQLite 方言（libSQL），SQL 无需改写；项目 `db.js` 已做**双后端**：
不配置环境变量 = 本地 SQLite（和以前一样，零依赖）；配置 `TURSO_URL`/`TURSO_TOKEN` = 自动切云端库。

### 操作步骤
#### 1) 拿 Turso 的 URL 和 Token（约 3 分钟）
- 打开 **https://app.turso.tech**，用 GitHub / Google 账号登录（免费版无需信用卡）
- 点 **Create Database** → 填名字（如 `lottery`）→ 地域建议选亚洲节点（Singapore `sin` 等，离 Render 近）
  - 若界面让选引擎，选**默认的 libSQL / SQLite 兼容**（不要选 `--tursodb` 那个新引擎，本项目用 `@libsql/client` 连接）
- 回到 Databases 列表，在该数据库这一行打开右侧 **⋯ 菜单**：
  - **Copy URL** → 得到 `libsql://lottery-xxxx.turso.io`（这就是 `TURSO_URL`）
  - **Create Token** → 权限选 **Read & Write**、有效期选 **Never / 不过期** → 复制那串 `eyJ...`（这就是 `TURSO_TOKEN`）
- CLI 备选（Windows 需 WSL）：
  ```bash
  turso auth signup
  turso db create lottery                       # 不加 --tursodb，建 libSQL 库
  turso db show lottery --url                   # URL
  turso db tokens create lottery --expiration none   # Token（永不过期）
  ```

#### 2) 拿 GitHub 仓库地址
- 打开 **https://github.com** 注册/登录 → 右上角 **+** → **New repository**
- 仓库名填 `lottery`，选 **Public** 或 Private 都行
- ⚠️ **不要**勾选 "Add a README / .gitignore / license"（本地仓库已有内容，勾了会冲突）
- 点 **Create repository**，页面会给出地址：`https://github.com/你的用户名/lottery.git`（这就是仓库地址）
- 推送代码（本机已 `git init` + 首次提交，且 `tunnel_key`、`data/`、`node_modules/` 已被 `.gitignore` 排除）：
  ```bash
  git remote add origin https://github.com/你的用户名/lottery.git
  git push -u origin main
  ```
  没配过 Git 身份认证的话，最简单是装 **GitHub Desktop**（登录后自动配置，Add local repository → Publish repository）；
  或用 Personal Access Token：GitHub → Settings → Developer settings → Personal access tokens → 勾 `repo` 生成，作为推送密码。

#### 3) Render 部署
- Render 控制台 → **New → Blueprint** → 选该仓库 → Apply（会自动读 `render.yaml`）
- 在面板里填 3 个环境变量：
  - `ADMIN_PASSWORD` = 你的管理密码（务必改掉默认值）
  - `TURSO_URL` = 第 1 步的 `libsql://...`
  - `TURSO_TOKEN` = 第 1 步的 `eyJ...`
- 部署完成后得到固定地址，例如 `https://lottery-xxxx.onrender.com`

#### 4) 验证
- 打开 `https://你的地址/api/health`，应返回 `{"ok":true,"mode":"turso"}`
- 打开 `/admin` 登录，建一个抽签抽一次，然后**手动重启服务**（Render 面板 Restart），数据应仍在

#### 5) 把现有本地数据搬上云（可选）
```bash
TURSO_URL=libsql://xxxx.turso.io TURSO_TOKEN=xxx npm run migrate:turso
```
脚本会把本机 `data/app.db` 的三张表整体写入云端库（幂等，可重复执行）。

> 需要交给协助部署者的信息：`TURSO_URL`、`TURSO_TOKEN`、GitHub 仓库地址（或 GitHub 用户名 + PAT）。
> Token 等同于数据库密码，只在私密渠道传递，用完可在 Turso 控制台 invalidate 撤销。

#### 交给 AI 代跑的一键脚本
拿到凭证后执行 `deploy-remote.js`，它会自动完成：验证云端库连通且可写 → 建 GitHub 仓库 → 推送代码 →
（可选）迁移本地数据 → 输出 Render 需要填的全部参数。

```bash
TURSO_URL=libsql://xxx.turso.io TURSO_TOKEN=eyJ... \
GITHUB_USER=你的用户名 GITHUB_TOKEN=ghp_... \
MIGRATE=1 ADMIN_PASSWORD=你的密码 \
node deploy-remote.js
```

- 凭证**只通过环境变量传入**，不写入任何文件、不打印完整值；git remote 保存为不含凭证的干净地址。
- `MIGRATE=1` 会把本机 `data/app.db` 的数据搬到云端库（覆盖云端同名表，仅首次需要）。
- 若另外提供 `RENDER_API_KEY` + `RENDER_OWNER_ID`，脚本会尝试用 Render API 直接创建服务；
  失败也不影响，会退回打印手工步骤。
- **Render 首次连接 GitHub 需要网页 OAuth 授权，这一步无法用 API 代替**，仍需人工在控制台点一次。

### 已知限制
- 免费 Render 实例闲置 15 分钟休眠，**首次访问约 30~60 秒冷启动**（之后正常）。活动开始前自己先点一次链接"热机"即可。
- `*.onrender.com` 是境外默认域名。微信一般能打开，但如被风控提示，走第 3 节绑自己的域名。
- 建议每月点一次后台的「完整备份」（见下）留个 JSON 兜底。

### 关于"微信必须备案"的澄清
ICP 备案是**中国大陆服务器**通过 80/443 提供 Web 服务的监管要求（云厂商会拦截未备案域名），
**不是微信浏览器的硬性要求**。使用境外服务器或境外 PaaS（香港节点 / onrender.com / lhr.life）时，
域名无需备案也能在微信打开；只有被大量举报或命中风控的域名才会显示"已停止访问该网页"。

---

## 2. 一次性活动（0 元临时）：localhost.run 隧道

本机有 OpenSSH 即可，**不用下载、不用买东西**，且**没有安全插页**：

```bash
ssh-keygen -t ed25519 -f tunnel_key -N "" -q -C "lottery-tunnel"
ssh -i tunnel_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL \
    -o IdentitiesOnly=yes -R 80:localhost:3000 nokey@localhost.run
```

Windows 直接双击 **`start-tunnel.cmd`**（起服务 + 开隧道 + 断线自动重连）。

- 输出 `https://xxxx.lhr.life`，微信 UA 实测直接返回应用、零插页。
- 限制：**电脑必须开机联网**；每次重连地址会变（免费版不能固定子域名）。
- ⚠️ **不要用 pinggy 免费隧道对外发链接**：它会对浏览器访客插入「注意：进入前请确保您信任本网站」页。
  该页由 pinggy 在请求到达你的服务器**之前**注入，改代码无法去掉；仅当请求头带 `X-Pinggy-No-Screen`
  或 UA 非浏览器时才跳过（普通用户做不到）。实测：curl 直取 1962 字节（应用本体），微信 UA 取到 15468 字节（插页）。

---

## 3. 自己掌控服务器（约 55 元/月，最稳）

买 **腾讯云轻量应用服务器·中国香港**（免备案）2核2G + 域名（约 10~70 元/年）：

1. 服务器地域选「中国香港」，镜像 Ubuntu 22.04；安全组放行 80、443。
2. 域名加 A 记录指向服务器公网 IP。
3. 上传项目后一条命令：`sudo bash deploy.sh 你的域名`（自动装 Docker + Caddy + 申请 HTTPS 证书）。
4. 数据落在服务器本地 `data/app.db`，用 `docker compose` 的持久卷，重启不丢。

不用 Docker 也行：服务器装 Node 22+，`npm install && npm start`，再用 PM2 守护。

---

## 4. 数据备份 / 恢复（任何模式都适用）

后台已内置完整备份接口（含全部抽签、结果项、参与名单）：

```bash
# 导出（需先登录拿 token）
curl -H "x-admin-token: $TOKEN" "https://你的地址/api/admin/backup" -o backup.json

# 恢复到任意部署（会覆盖目标库全部数据，谨慎）
curl -X POST -H "x-admin-token: $TOKEN" -H "Content-Type: application/json" \
     --data-binary @backup.json "https://你的地址/api/admin/restore"
```

单场抽签名单也可以在后台点「导出 CSV」。服务器模式下直接备份 SQLite 单文件即可：
```bash
cp /opt/lottery/data/app.db /opt/lottery/data/app.db.bak-$(date +%F)
```

---

## 5. 配置与运维

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | `Tdsw2008` | 管理后台密码，**生产务必改** |
| `TURSO_URL` | 空 | 设置后启用云端持久库（如 `libsql://xxx.turso.io`） |
| `TURSO_TOKEN` | 空 | Turso auth token |
| `DATA_DIR` | `./data` | 仅本地模式有效 |
| `PORT` | `3000` | 监听端口 |

- 健康检查：`GET /api/health` → `{"ok":true,"mode":"local"|"turso"}`
- 回归测试：`npm test`（local）；`TURSO_URL=file:./test.db node selftest.js`（turso 路径，无需账号）
- 改密码：环境变量优先于代码默认值；`ADMIN_PASSWORD=新密码 npm start`

---

## 6. 本地开发

```bash
npm install                 # 只有云端模式需要；本地模式零依赖也能跑
npm start                    # http://localhost:3000，后台 /admin
npm test                     # 数据层回归测试
```

不设 `TURSO_URL` 时完全走 Node 内置 `node:sqlite`，数据在本机 `data/app.db`，无需任何外部服务。
