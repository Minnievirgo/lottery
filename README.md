# 抽签软件（Lottery App）

纯 Node.js 实现的抽签系统：**零 npm 依赖**（使用 Node 内置 `http` 服务 + 内置 `node:sqlite` 数据库）。包含面向用户的抽签页和管理后台。

## 功能

- **管理后台**（密码保护）：创建 / 编辑多个抽签活动，可视化设置结果项（名称、数量上限、权重、颜色），开启 / 结束 / 删除，查看参与名单，统计，导出 Excel 兼容 CSV，一键复制分享链接。
- **用户抽签页**（暗色科技风、移动优先）：点击分享链接进入指定抽签 → 输入姓名 → 抽签 → 结果发光揭晓 + 撒花动效。
- **抽签逻辑（限量 + 随机混合）**：在「剩余 > 0 或 不限量」的结果项里按权重随机抽一个；限量项抽中后剩余 -1；全部限量抽完显示「已抽完」；开启防重复后同一姓名只回显其已抽结果，不重复消耗名额。

## 运行

需要 **Node.js ≥ 22.5**（内置 `node:sqlite`）。

```bash
cd lottery
node --experimental-sqlite server.js
# 或： npm start
```

启动后：

- 用户抽签页：http://localhost:3000/?d=抽签ID
- 管理后台：http://localhost:3000/admin
- 默认管理员密码：`admin888`

### 修改管理员密码

```bash
ADMIN_PASSWORD=你的密码 node --experimental-sqlite server.js
```

### 自定义端口

```bash
PORT=8080 node --experimental-sqlite server.js
```

## 使用流程

1. 打开 `/admin`，用密码登录。
2. 点「新建抽签」：填标题、说明，勾选是否防重复，添加结果项（如「一等奖 ×1」「二等奖 ×3」「谢谢参与 不限量」），保存。
3. 在列表里点「复制链接」，把 `http://你的域名/?d=ID` 发给用户。
4. 用户打开链接 → 输入姓名 → 抽签。
5. 在后台可随时查看「名单」「统计」，或「导出 CSV」拿到 Excel 名单。

## 部署说明

- 本地 / 内网：直接 `node server.js` 运行，用户通过局域网 IP 访问。
- 公网：把 `lottery/` 文件夹放到任意支持 Node 的服务器（如云主机、Railway、Render、Fly.io），`npm start` 即可；用 Nginx / Caddy 反代并配置 HTTPS 域名后，分享链接换成你的域名。
- 数据存放在 `lottery/data/app.db`（SQLite 文件），备份该文件即可。

## 文件结构

```
lottery/
├── server.js        # HTTP 服务 + API 路由 + 鉴权
├── db.js            # node:sqlite 数据层（建表、抽签事务、统计、导出）
├── package.json
├── data/            # SQLite 数据库（自动生成）
└── public/
    ├── index.html / user.css / user.js   # 用户抽签页
    └── admin.html / admin.css / admin.js # 管理后台
```
