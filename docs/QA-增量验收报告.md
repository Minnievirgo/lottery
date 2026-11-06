# QA 增量验收报告 · 导出名单排序 / 发言顺序表 / 分享二维码

| 项 | 内容 |
|---|---|
| 报告类型 | 独立验收（QA 不复用工程师造数与断言，全部重新设计） |
| 执行人 | 严过关（Edward / QA Engineer） |
| 日期 | 2026-11-06 |
| 被测提交 | `d11c91c`（初验）+ `6a7cfd7`（P2 修复）+ 第 2 轮定点回归提交（测试断言 + 本报告，见 §11）；**均未 push** |
| 依据 | `docs/PRD-增量-导出与分享.md`（AC-1.x / 2.x / 3.x）、`docs/DESIGN-增量-导出与分享.md`（§5 / §6 / §7 / §10） |
| 结论 | **F1 / F2 全通过；F3 主解码器 6/6 真解码通过**；发现 1 个 P2 健壮性缺陷（非阻断），**已由工程师在 `6a7cfd7` 修复并经 QA 两轮定点回归闭环**；防回归断言已固化进 `selftest-qr.js`；另余若干人工真机验收项 |
| 路由判定 | 对 `d11c91c`：**Engineer**（1 项二维码半像素原点缺陷，已闭环）。**最终判定（第 2 轮结束）：`NoOne`** —— 全绿、无待修源码缺陷。见 §8 / §10 / §11 |

---

## 0. 结论速览

| 指标 | 数值 |
|---|---|
| QA 独立新增断言 | **91 项，全部通过**（E2E 33 + XML 解析 42 + QR 真解码 16） |
| 工程师自测套件复核 | `npm run test:all` 四套全绿；`selftest-schedule.js` 20/20；`selftest-qr.js` **9/9**（第 2 轮新增 2 项防回归断言） |
| 镜像 SHA-256 | `npm run build:cloudbase` 重跑后 **29 对全部一致**，`git status --porcelain` 保持空 |
| 双驱动 CSV | local / cloudbase **441 字节逐字节完全一致** |
| 二维码真解码 | **已做到**：无头 Chrome 真实渲染 6 张 800×800 PNG → ZXing 独立解码 **6/6** 逐字符匹配 `makeShareUrl`，3 origin × 2 drawId 不串场 |
| 阻塞缺陷 | **0** |
| 需 Engineer 处理 | **1 项 P2**（`qr-render.js` 半像素原点，见 §5.3）→ **已在 `6a7cfd7` 修复并闭环**，见 §10 |
| 未验证 / 需人工 | 4 类，见 §6 / §7 |
| 测试轮次 | **2 轮**（硬上限，未进入第 3 轮）：Round 1 初验 → Round 2 为 `6a7cfd7` 修复后正式定点回归（§11） |

> 与工程师自报的差异：工程师只做了静态断言（`selftest-qr.js` 检查 QR 矩阵、finder 模板、源码无 `clip`），**从未真正生成并解码过 PNG**。本报告用 `canvas.toDataURL()` 的真实输出做了端到端解码，并因此发现了静态断言覆盖不到的半像素原点缺陷与 jsQR 兼容性风险。

---

## 1. 测试环境

| 项 | 值 |
|---|---|
| OS | Windows（Git Bash） |
| Node | v22.22.2（`node:sqlite` 可用） |
| npm | 10.9.7 |
| Python | 3.13.14（`xml.etree.ElementTree`、Pillow 13.0.0） |
| 浏览器 | `C:\Program Files\Google\Chrome\Application\chrome.exe`（headless=new，`--dump-dom`）、Edge 可用 |
| 表格软件命令行 | **未安装**（无 `soffice` / LibreOffice / WPS / Excel CLI）→ `.xls` 真实软件打开标注为「需人工」 |
| 项目路径 | `C:\Users\ThinkPad\WorkBuddy\2026-11-04-00-13-01\lottery` |
| QA 临时目录 | `C:\Users\ThinkPad\AppData\Local\Temp\qa-lottery-20261106\`（**系统临时目录，不在项目内**） |
| 临时解码工具 | `jsqr`、`pngjs`、`@zxing/library` 装在临时目录 `qrtools/`，`--no-save --no-package-lock`；**项目 `package.json` / `package-lock.json` 零改动** |
| 服务隔离 | `spawn(node --experimental-sqlite server.js)`，端口 `33161`（local）/ `33162`（cloudbase mock）；`DATA_DIR` 指向临时目录；`ADMIN_PASSWORD` 独立设置；测完 `kill()` |
| 数据库安全 | 全部 local SQLite 隔离目录 / 内存 CloudBase mock；**未对真实 Turso 云端库做任何写操作** |
| 解码器 | 主：`@zxing/library`（ZXing JS，与 jsQR 完全独立实现）；次：`jsqr`；备选 `opencv-python-headless` 安装超时（11 分钟被终止，见 §6） |

**独立造数**（QA 自行设计，与工程师造数无关）：通过真实 `POST /api/admin/restore` 注入 4 场抽签 / 60 条参与记录。

| 场次 | 数据设计 | 用途 |
|---|---|---|
| `qa-draw-A` QA混排名单 | 12 人：`5`(早) / `5`(晚) / `6` / `13` / `14` / `17` / `38` / `43` / `一等奖` / `特等奖` / `null` / `""` | F1 排序、非数字/空值、同值不同时间、混排名单排程 |
| `qa-draw-B` QA时间线 | 8 人纯数字 `5,6,13,14,17,38,43,99` | AC-2.1 精确时间线、XML 结构、间隔 0、备注清空、标题/备注修改 |
| `qa-draw-C` QA空名单 | 0 人 | `no_participants`、基线 `performDraw` |
| `qa-draw-D` QA容量40人 | 40 人 | `capacity_exceeded` |

---

## 2. 测试策略与轮次控制

- **不确认文件存在、不重复工程师断言**：全部通过真实 HTTP（`fetch` 原始字节）驱动真实 `server.js` 进程；造数、鉴权、导出、排程、下载全链路走产品代码。
- **Round 1**：写测试 → 执行 → 分析。E2E 30/33、XML 36/42、QR 首轮 9/17。失败全部判定为**测试代码自身缺陷或解码器特性**，标 `QA` 自行修复（详见 §5.1 / §5.2）。
- **Round 2**：修复后回归。E2E 33/33、XML 42/42、QR 最终 16/16。
- **未进入 Round 3**（硬上限）。Round 2 后剩余的源码健壮性缺陷与人工项按「Known Issues / 遗留风险」记录，不再循环调试。

---

## 3. 逐项用例与结果

### 3.1 F1 · 真实 HTTP 导出 CSV（AC-1.x）

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1 | 双真实服务启动（local + cloudbase mock） | 通过 | `/api/health` → `{ok:true,mode:'local'}` / `{ok:true,mode:'cloudbase'}` |
| 2 | 管理员登录取 `x-admin-token` | 通过 | 200 + HMAC token（52 字符） |
| 3 | 经真实 HTTP `restore` 注入造数（顺带回归 `importAll`） | 通过 | 4 场 / 60 条 |
| 4 | CSV 以 UTF-8 BOM 开头 | 通过 | 首 3 字节 `EF BB BF` |
| 5 | 三列表头 / 文件名 / 中文不乱码 | 通过 | `姓名,抽签结果,抽签时间`；`filename="QA%E6%B7%B7%E6%8E%92%E5%90%8D%E5%8D%95-%E5%90%8D%E5%8D%95.csv"` |
| 6 | 数据行数 12（不含表头） | 通过 | 13 行 |
| 7 | **数值升序**：`5,5,6,13,14,17,38,43`；`"13"` 不在 `"5"` 前 | 通过 | 结果列见 §4.1 |
| 8 | 非数字文本在所有数字之后、彼此按 `localeCompare('zh-CN')` 稳定 | 通过 | `特等奖, 一等奖` |
| 9 | `null` / 空串排最后且为空单元格 | 通过 | 末两行结果列为空 |
| 10 | 同结果按 `drawn_at` 升序（先抽者在前） | 通过 | 两个 `5` → `宋亚轩, 甲同值` |
| 11 | 中文姓名原样输出无乱码 | 通过 | `宋亚轩 / 白敬亭 / 一等奖` 等 |
| 12 | **AC-1.7 双驱动逐字节一致** | 通过 | local 与 cloudbase CSV 均 441 字节，`Buffer.equals()` 为 true |

> 说明：结果列非数字部分为 `特等奖` 在 `一等奖` 之前，符合 PRD §4.1 规则 3「`localeCompare('zh-CN')` 字典序」（拼音 `te` < `yi`）。QA 侧用平台 `localeCompare` 独立计算期望值，非复用产品代码。

**小计：12/12 通过。**

### 3.2 F2 · 真实 HTTP `POST /export-schedule`（AC-2.x）

| # | 用例 | 结果 | 关键断言 |
|---|---|---|---|
| 1 | 合法参数 200 | 通过 | `Content-Type: application/vnd.ms-excel`；`Content-Disposition: attachment; filename="schedule.xls"; filename*=UTF-8''…`；体以 `<?xml` 开头且无 BOM |
| 2 | XML 体含大标题 / 红字表头 / 「课间休息15分钟」 / `08:40` / 空列 | 通过 | 含 `#C00000`、`sHead`、`10:35`、`<Cell ss:StyleID="sCell"/>`；无 `<MergeCells>` |
| 3 | AC-2.1 默认时间线 | 通过 | `08:40–08:50 … 10:10–10:20`，休息后 `10:35–10:45`，16 个 HH:mm 齐备 |
| 4 | XML 特殊字符注入 `< & " '` + 换行到 title/remark | 通过 | 200；转义为 `&lt; &amp; &quot; &apos; &#10;`；`Content-Disposition` 无 CRLF 注入 |
| 5 | 注入文本经 Python 解析逐字符无损还原 | 通过 | 见 §3.3 |
| 6 | 混排名单（含一等奖 / 空值 / 同值）参与排程 | 通过 | 200，12 人全部排入，无崩溃 |
| 7 | `gap=0` 允许且首尾相接；关闭休息无休息行；备注清空后备注行仍在 | 通过 | `08:40/08:50 → 08:50/09:00`；`sRemark` 行存在且 `<Data>` 为空 |
| 8 | 标题 / 备注修改同步进 XML 与 `filename*` | 通过 | `自定义标题XYZ` / `自定义备注ABC` 均出现 |
| 9 | `duration=0` → 400 `invalid_params` | 通过 | `fields.duration = 每人发言时长必须大于 0 分钟` |
| 10 | `gap=-1` → 400 `invalid_params` | 通过 | `fields.gap = 发言间隔不能为负数` |
| 11 | 上午开始 ≥ 上午结束 → 400 | 通过 | `fields.amEnd` |
| 12 | 下午开始 ≤ 上午结束 → 400 | 通过 | `fields.pmStart` |
| 13 | 下午开始 ≥ 下午结束 → 400 | 通过 | `fields.pmEnd` |
| 14 | 空名单 → 400 `no_participants` | 通过 | `{"error":"no_participants","message":"暂无参与记录"}` |
| 15 | 超容量 → 400 `capacity_exceeded` | 通过 | `capacity:26, total:40, overflow:14`，`capacity+overflow=total`，`advice` 非空，未生成文件 |
| 16 | 校验优先于容量（duration=0 + 40 人） | 通过 | 仍 `invalid_params` |

**错误响应原文（真实 HTTP 抓包）：**

```json
{"error":"invalid_params","message":"时间参数或发言节奏设置不合法","fields":{"duration":"每人发言时长必须大于 0 分钟"}}
{"error":"capacity_exceeded","message":"当前时间参数最多可安排 26 人，当前 40 人，超出 14 人。建议缩短发言时长 / 间隔，或延长下午结束时间","capacity":26,"total":40,"overflow":14,"advice":"建议缩短发言时长 / 间隔，或延长下午结束时间"}
{"error":"no_participants","message":"暂无参与记录"}
```

**小计：16/16 通过。**

### 3.3 `.xls` 真实解析（Python `xml.etree.ElementTree`）

对 4 份真实 HTTP 响应落盘的 `.xls`（`schedule-B.xls` / `schedule-inject.xls` / `schedule-A-mixed.xls` / `schedule-gap0.xls`）逐份解析：

| # | 校验项 | 结果 | 实测 |
|---|---|---|---|
| 1 | XML 良构、根为 `Workbook` | 通过 | 4/4 |
| 2 | SpreadsheetML 命名空间 / `mso-application progid="Excel.Sheet"` / 无 BOM | 通过 | `xmlns` / `xmlns:ss` / `xmlns:x` 齐备 |
| 3 | **无 `<MergeCells>` 元素** | 通过 | 0 个（4 份） |
| 4 | `ss:ExpandedRowCount` == 实际 `<Row>` 数；列数 7 | 通过 | 12 / 12 / 16 / 11；全部 = 实际行数 |
| 5 | 每行 `ss:Index` 连续 1..N | 通过 | 12 / 12 / 16 / 11 行 |
| 6 | `ss:MergeAcross=6` 锚点独占整行；`ss:MergeDown=N` 覆盖行存在且 A 列省略、首格 `ss:Index="2"` | 通过 | 4 / 4 / 5 / 3 个合并锚点，全部自洽 |
| 7 | 8 个 Style ID / `#1E4E9C` 蓝底 / `#C00000` 红字 / `#2563B4` 休息行 / 四边细黑框线 | 通过 | 4/4 |
| 8 | R1 大标题跨 7 列；R2 = `时段/序号/日期/分公司/姓名/开始时间/结束时间` | 通过 | 4/4 |
| 9 | AC-2.6「日期 / 分公司」为带 `sCell` 样式但无 `<Data>` 的空单元格 | 通过 | 16 / 16 / 24 / 16 个 |
| 10 | AC-2.1 时间线 + 休息行 + 休息行 `sBreak` 跨列独占整行 | 通过 | 16 个 HH:mm + 1 条「课间休息15分钟」 |
| 11 | AC-2.14 人员顺序 = F1 CSV 数值升序 | 通过 | `宋亚轩/贾玉婵/宋白/林漪挺/刘耀文/白敬亭/张真源/第8人` |
| 12 | 注入文本解析后逐字符还原 | 通过 | 标题 `QA注入<title>&"双引号"'单引号'`、备注含 `\n` 均无损 |
| 13 | `gap=0` / 无休息 / 空备注行仍存在 | 通过 | `09:00` 出现；末行 `sRemark` 且 `<Data>` 为空 |
| 14 | 非数字 / 空结果参与排程不崩溃 | 通过 | 12 人全部出现 |

**小计：42/42 通过。**

> ⚠️ **未做**：本机无 LibreOffice / WPS / Excel 命令行转换工具，无法用真实表格软件打开验证「蓝底白字、纵向合并、不弹『文件格式与扩展名不一致』阻断」。此项按任务要求**如实标注为「需人工 Excel/WPS 双开」，未假装验证过**。

### 3.4 二维码 PNG 真实渲染 + 真解码（AC-3.x，本轮最高风险）

**渲染链路（真实产品代码，非模拟）**：无头 Chrome `--headless=new --dump-dom` 打开临时 HTML（位于系统临时目录），以 `file://` 绝对路径加载项目真实的 `public/vendor/qrcode.js` → `public/lib/share-url.js` → `public/qr-render.js`，调用 `ShareUrl.makeShareUrl(origin, drawId)` 与 `LotteryQR.render(canvas, url, {size:800})`，取 `LotteryQR.toDataURL(canvas)` —— **即产品「下载二维码 PNG」按钮的同一输出**。

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1 | 6 组真实 PNG 渲染成功 | 通过 | `ok:true`，`vendor=function` / `ShareUrl=object` / `LotteryQR=object`，800×800 |
| 2 | **主解码器 ZXing 真解码 6/6** | 通过 | 见下方解码字符串清单，逐字符等于 `makeShareUrl` 输出 |
| 3 | 3 origin × 2 drawId 不串场 | 通过 | 6 个解码结果全部唯一，各自匹配自身 origin + id |
| 4 | 像素级：3 个 7×7 finder 完整未被遮挡（6 张全查） | 通过 | 每张 3×49=147 个模块中心像素明暗与 QR 矩阵逐格一致 |
| 5 | 800×800 / 静区 4 / 圆点网格 / finder 强制实心方块 | 通过 | `QUIET=4`、`0.86u` 圆点、`fillRect` finder |
| 6 | 中心星空盘占比 | 通过 | `0.20*L = 98.4px = 20.0%L`；含白晕 `122.4px ≈ 24.9%L`，遮挡面积 ≈ 4.9%（H 级 30% 容错内） |
| 7 | QR 层无 `clip()`、无 `destination-out`；`destination-in` 仅用于离屏星空合成 | 通过 | 剔除注释后的源码检查 |
| 8 | 源码无硬编码域名 | 通过 | `qr-render.js` / `share-url.js` 无任何 `http(s)://` 常量 |
| 9 | MIT 署名保留、零新增 npm 依赖 | 通过 | vendor 含 `Kazuhiko Arase` + MIT 许可；`package.json` 仅 `@libsql/client`；云函数 `package.json` 仅 `@cloudbase/node-sdk` |
| 10 | 次解码器 jsQR 兼容性 | ⚠️ 风险 | 装饰版 **1/6**、`plain` 回退版 **5/6**；ZXing 装饰版 6/6（详见 §5.3 / §6） |

**6 张 PNG 的真实解码字符串（ZXing，`HybridBinarizer` 与 `GlobalHistogramBinarizer` 均 OK）：**

```
http://localhost:3000            + qa-draw-B        => http://localhost:3000/?d=qa-draw-B        (M=33)
http://localhost:3000            + Zm9vYmFyLTIwMjY  => http://localhost:3000/?d=Zm9vYmFyLTIwMjY  (M=37)
https://lottery-qa.onrender.com  + qa-draw-B        => https://lottery-qa.onrender.com/?d=qa-draw-B        (M=37)
https://lottery-qa.onrender.com  + Zm9vYmFyLTIwMjY  => https://lottery-qa.onrender.com/?d=Zm9vYmFyLTIwMjY  (M=41)
https://final.example.com        + qa-draw-B        => https://final.example.com/?d=qa-draw-B        (M=37)
https://final.example.com        + Zm9vYmFyLTIwMjY  => https://final.example.com/?d=Zm9vYmFyLTIwMjY  (M=37)
```

PNG 产物保存在系统临时目录：`qr-0.png` … `qr-5.png`（原图，圆外透明）、`qr-*-white.png`（合成白底）、`qr-*-plain.png`（`plain:true` 回退版）。

**小计：16/16 通过（另记录 1 项兼容性风险）。**

### 3.5 双驱动 / 镜像 / 依赖

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1 | `DB_DRIVER` 默认（`db.js`）与 `cloudbase`（`db-cloudbase.js`）导出同一造数逐行比对 | 通过 | 441 字节逐字节一致 |
| 2 | `npm run build:cloudbase` 重跑 | 通过 | 重建后 `git status --porcelain` 为空 |
| 3 | 主文件 → 镜像 SHA-256 全量比对 | 通过 | **29 对，0 不一致** |
| 4 | `cloudbase/function/package.json` 未变 | 通过 | `git diff HEAD~1 HEAD` 为空；依赖仍只有 `@cloudbase/node-sdk` |
| 5 | `package.json` / `package-lock.json` / `Dockerfile` / `render.yaml` / `build-cloudbase.js` / `cosmic-bg.js` 零改动 | 通过 | `git diff HEAD~1 HEAD` 为空 |
| 6 | 所有新增/改动 `.js` 通过 `node --check` | 通过 | 42 个改动文件中全部 `.js` 无语法错误 |

### 3.6 边界 / 回归 / 反面

| # | 用例 | 结果 |
|---|---|---|
| 1 | 未带 `x-admin-token` 访问新接口 → 401 | 通过 `{"ok":false,"message":"未授权，请先登录"}` |
| 2 | 伪造 `x-admin-token` → 401 | 通过 |
| 3 | `GET /export` 未带 token 仍 401（基线鉴权未变） | 通过 |
| 4 | 基线 `exportAll`：`version:1`、4 场、参与者仍按 `drawn_at` 顺序；`importAll` 幂等 | 通过 |
| 5 | 基线 `performDraw` 抽签 + `anti_duplicate` 生效 | 通过 |
| 6 | 用户页 `GET /` 200 且含星系背景；短链 `/d/<id>` 302 → `/?d=<id>` | 通过 |
| 7 | 用户页 `public/index.html` / `user.js` / `user.css` 本次 commit 零改动 | 通过（`git diff` 为空） |
| 8 | 对照 `HEAD~1` diff：`db.js` / `db-cloudbase.js` 仅 `exportCSV` 排序 + `id` 列 + `limit=10000`；`GET /export` 路由**一字未改**；`exportAll` / `importAll` / `performDraw` 未改 | 通过 |
| 9 | 两个真实服务进程 stderr 无 `[fatal]` / `[error]` | 通过 |
| 10 | `npm run test:all` 四套全绿（最终重跑） | 通过 |
| 11 | `node selftest-schedule.js` 20 项 / `node selftest-qr.js` 7 项 | 通过 |
| 12 | `admin.html` script 顺序 `cosmic-bg → result-sort → share-url → qrcode → qr-render → admin.js` | 通过 |
| 13 | 卡片 `copyLink` 与二维码弹窗均调 `ShareUrl.makeShareUrl(location.origin, id)` | 通过（L205 / L469） |
| 14 | 全仓源码硬编码域名扫描（排除 vendor 注释与启动日志） | 通过；仅 `server.js:250-251` 的 `console.log('http://localhost:'+PORT)` 为既有启动提示，不参与码内容 |

**补充静态核对（不计入 91 项断言）**：`public/admin.js:15` `SCH_KEY='lottery_schedule_params_v1'`；`SCH_ALL_KEYS` = 4 个时间 + 4 个整数 + `breakEnabled` + `remark` 共 **10 个字段，不含 `title`**（L14 / L415 注释明确「切换场次自动刷新」），与工程师说明一致；`admin.html:174-179` 六个 script 顺序 `cosmic-bg → result-sort → share-url → qrcode → qr-render → admin.js` 正确。

---

## 4. 关键证据

### 4.1 CSV 行序（真实 `GET /export` 响应，UTF-8 BOM `EF BB BF`，441 字节）

```
姓名,抽签结果,抽签时间
宋亚轩,5,2025/11/6 11:33:21
甲同值,5,2025/11/6 11:33:28      ← 同值 5，drawn_at 晚，排在后面
贾玉婵,6,…
宋白,13,…                        ← "13" 未排在 "5" 之前（字符串排序回归已防住）
林漪挺,14,…
刘耀文,17,…
白敬亭,38,…
张真源,43,…
丙非数字,特等奖,…                ← 非数字在全部数字之后（zh-CN 字典序）
乙非数字,一等奖,…
丁空值,,…                        ← null → 空单元格，末尾
戊空串,,…                        ← "" → 空单元格，末尾
```

### 4.2 XMLSS 响应原文片段

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="…" xmlns:x="…"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="…">
  <Styles><Style ss:ID="sTitle"><Font ss:FontName="微软雅黑" ss:Size="16" ss:Bold="1" ss:Color="#FFFFFF"/>
    <Interior ss:Color="#1E4E9C" ss:Pattern="Solid"/></Style>…</Styles>
  <Worksheet ss:Name="发言顺序">
    <Table ss:ExpandedColumnCount="7" ss:ExpandedRowCount="12" …>
      <Row ss:Index="1"><Cell ss:StyleID="sTitle" ss:MergeAcross="6">…</Cell></Row>
      <Row ss:Index="3"><Cell ss:StyleID="sPeriod" ss:MergeDown="6">上午</Cell>
        <Cell ss:StyleID="sCell"><Data ss:Type="Number">1</Data></Cell>
        <Cell ss:StyleID="sCell"/>          ← 日期：带边框空单元格
        <Cell ss:StyleID="sCell"/>          ← 分公司：带边框空单元格
        <Cell ss:StyleID="sCell"><Data ss:Type="String">宋亚轩</Data></Cell>
        <Cell ss:StyleID="sCell"><Data ss:Type="String">08:40</Data></Cell>…</Row>
      <Row ss:Index="4"><Cell ss:Index="2" …>…</Row>   ← 被纵向合并行省略 A 列
      <Row ss:Index="10"><Cell ss:StyleID="sBreak" ss:MergeAcross="6">
        <Data ss:Type="String">课间休息15分钟</Data></Cell></Row>
```

Python 解析结论：`ExpandedRowCount=12 == 实际 12 行`；`<MergeCells>` 0 个；4 个合并锚点自洽；被合并行 A 列省略且首格 `ss:Index="2"`。

### 4.3 PNG 真解码

见 §3.4 的 6 条解码字符串。解码输入为产品 `toDataURL` 输出（原 PNG，圆外透明）合成白底后的 RGBA；`HybridBinarizer` 与 `GlobalHistogramBinarizer` 两种配置均成功。

---

## 5. 发现的问题与调查

### 5.1 Round 1 — QA 测试代码自身缺陷（标 `QA`，已自行修复）

| # | 失败断言 | 调查结论 | 修复 |
|---|---|---|---|
| 1 | `cd.includes('-名单.csv')` | `GET /export` 基线的文件名是 `encodeURIComponent(整个 title+'-名单.csv')`，中文被百分号编码；`git show HEAD~1:server.js` 与 HEAD 逐字比对确认**基线写法一字未改**，是断言写错 | 改为 `cd.includes(encodeURIComponent('QA混排名单-名单.csv'))` |
| 2 | `cd.includes('-发言顺序.xls')` | `filename*` 是 RFC 5987 百分号编码（`-发言顺序.xls` → `-%E5%8F%91%E8%A8%80%E9%A1%BA%E5%BA%8F.xls`），设计 §5.1 明确要求 | 改为断言 `filename="schedule.xls"` ASCII 回退 + `filename*=UTF-8''` + `encodeURIComponent(中文名)` |
| 3 | 伪造 token 用中文，`fetch` 抛 `ByteString` 错误 | HTTP 头值必须 latin1，是测试造的非法请求，不是产品问题 | 改用纯 ASCII 伪造 token |
| 4 | Python `structure()` 返回 3 值却按 3 值解包 `load()`（只返回 2 值） | 测试脚本 bug | 改为 `raw, root = load(...)` + `rows = all_rows(root)` |
| 5 | Python「被合并行存在落在 A 列的 Cell」 | 我的检查把「省略 `ss:Index` 顺序承接」的单元格误判为落在 A 列；实际首格 `ss:Index="2"`，后续格顺接 | 改为列游标计算，断言无 Cell 落在第 1 列 |

以上 5 项**均为测试代码缺陷，未改动任何产品源码**。修复后 Round 2 全绿。

### 5.2 Round 1 — 解码器特性调查（非产品缺陷）

- **jsQR 完全忽略 alpha 通道**（`binarize()` 只读 RGB，见 `jsqr/dist/jsQR.js:410-425`）。装饰版 PNG 圆外是透明的 `(0,0,0,0)`，被 jsQR 当作纯黑区域。真实相机 / 浏览器看到的是白底，故在 QA 侧把 PNG 合成到白底后再解码（也保留原图结果做对照）。
- **jsQR 的 `onlyInvert` 选项**会传入 `undefined` 的 `inverted` 矩阵导致崩溃（`jsQR.js:9979`），已剔除该选项。
- 因此 QR 验收以确定**主解码器 ZXing**的结论为准，jsQR 结果仅作兼容性参考。

### 5.3 需 Engineer 处理 — 1 项 P2 健壮性缺陷（非阻断）

**问题**：`public/qr-render.js` 的 QR 方阵原点 `ox/oy` 可能是半像素，导致三个 finder pattern 出现抗锯齿白色细缝（视觉退化为网格而非实心方块），并降低部分解码器的识别率。设计 §7.2 明确写「`u` 取整数避免半像素模糊」，但只保证了 `u` 为整数，未保证 `L = u*G` 为偶数、`ox = cx - L/2` 为整数。

| 项 | 内容 |
|---|---|
| 源码位置 | `public/qr-render.js:264` `var ox = cx - L / 2, oy = cy - L / 2;`<br>`public/qr-render.js:256` `drawModules(ctx, inst, M, cx - LPlain / 2, cy - LPlain / 2, uPlain, true);` |
| 镜像（必须同步） | `cloudbase/hosting/qr-render.js:264/256`、`cloudbase/function/public/qr-render.js:264/256`（改后执行 `npm run build:cloudbase`） |
| 触发条件 | `SIZE=800`、`PAD=24`、`QUIET=4`；`M=37` → `G=45`、`u=11`、`L=495` → **`ox=152.5`**；`M=41` 的 `plain` 分支 → `uPlain=15`、`LPlain=735` → **`ox=32.5`**。而 `M=33`（`L=492`）→ `ox=154` 整数，正常。**生产常见长度的 URL 恰好落在 M=37，故命中率不低。** |
| 失败断言 | `jsQR(compositeWhite(PNG), 800, 800).data === 'https://lottery-qa.onrender.com/?d=Zm9vYmFyLTIwMjY'`（`plain:true` 版，M=41）→ **实际 `null`（未解码）**；同一 PNG 用 ZXing 可解码 |
| 对照实验 | 在**系统临时目录的副本**（未改产品源码）把两处原点改为 `Math.round(...)` 后重渲染：`plain` 版 jsQR 由 **5/6 → 6/6**，装饰版由 **1/6 → 2/6**；可见半像素细缝消失 |
| 视觉证据 | `qr-0.png`(M=33, ox=154) / `qr-3.png`(M=41, ox=155) finder 为**实心方块**；`qr-1.png` / `qr-2.png` / `qr-4.png` / `qr-5.png`(M=37, ox=152.5) finder 内部可见**细白网格缝** |
| 建议修复 | `var ox = Math.round(cx - L / 2), oy = Math.round(cy - L / 2);` 及 `Math.round(cx - LPlain / 2)` / `Math.round(cy - LPlain / 2)`；随后 `npm run build:cloudbase`，并重跑 `selftest-qr.js` / `npm run test:all` |
| 严重度 | **P2 / 非阻断**。ZXing 对现状 6/6 全部解码成功，主验收 AC-3.1/3.7 通过；但 PRD P0-7 与 AC-3.4 要求 finder 完整可扫，且 `plain:true` 是设计预留的「真机解码失败回退开关」，该开关在 M=41 时对 jsQR 失效，建议修复 |

> 依据 2 轮硬上限，QA 不再进入第 3 轮回归；若主理人决定修复，建议由 Engineer 改完后交回 QA 做一次定点回归（或并入下轮迭代）。

### 5.4 兼容性风险 — jsQR 对装饰版识别率低

| 解码器 | 装饰版（默认） | `plain:true` 回退版 |
|---|---|---|
| **ZXing JS（主）** | **6/6** | 6/6（至少一种二值化配置） |
| jsQR（次） | 1/6 | 5/6（半像素取整后 6/6） |

调查：即使把半像素原点取整，装饰版 jsQR 仍只有 2/6。原因是 jsQR 的局部自适应二值化对「深色中心星空盘（近黑）+ 圆点化模块 + 装饰弧线」敏感；ZXing（更接近 Android/微信/系统相机所用 ZXing / Vision 系实现）全部识别。因此判定为**兼容性风险而非阻断缺陷**，但必须在真机上复核（见 §7）。设计已预留 `plain:true` 回退开关，若真机不过可一键回退。

---

## 6. 遗留风险清单

| # | 风险 / 未验证项 | 状态 | 影响与建议 |
|---|---|---|---|
| R1 | **Excel / WPS 真实打开 `.xls` 的排版还原**（蓝底白字、A 列纵向合并、休息行跨列、空列边框、是否弹「文件格式与扩展名不一致」） | **未验证** | 本机无 LibreOffice / WPS / Excel 命令行工具。XML 结构已用 ElementTree 完整校验（42/42），但按任务要求**如实标注需人工 Excel/WPS 双开**，未假装验证过。**工程师补充说明**：Excel 2007+ 按文件头嗅探「XMLSS 内容 + `.xls` 扩展名」通常会弹一次「是/否」确认，点「是」后样式与合并单元格完整保留；WPS 一般不弹。此为设计 §1.2 / R2 已记录的取舍，非缺陷，但人工验收须区分「可继续的确认框」与「硬阻断」 |
| R2 | **微信「扫一扫」+ Android / iOS 系统相机真机扫码、换场不串场**（AC-3.3） | **未验证** | 需用真机；自动化已用 ZXing 6/6 + 像素级 finder 校验替代到最大限度 |
| R3 | **jsQR 兼容性**：装饰版 1/6、`plain` 5/6 | 已记录 | 真机若不过，启用 `plain:true` 回退；或采纳 §5.3 修复 + 适当缩小/提亮中心星空盘 |
| R4 | ~~半像素原点缺陷~~ | **已修复闭环**（`6a7cfd7` + 第 2 轮定点回归 + 防回归断言入库） | 见 §5.3 / §10 / §11；此风险已消除 |
| R5 | **视觉主观项**：星空非猫爪、圆点非放射短线、圆形外观、窄屏 7 按钮换行、打印友好列宽/行高 | 部分验证 | 源码静态断言 + 3 张 PNG 目视（圆点、圆形、三 finder 完整、中心为蓝紫金星系）已做；最终观感需人工确认 |
| R6 | **第三解码器 OpenCV** | 未验证 | `pip install opencv-python-headless` 网络挂起 11 分钟后被终止；已用 ZXing + jsQR 双解码器替代，不影响结论 |
| R7 | **超大名单（>10000 人）** | 未验证 | `db-cloudbase.js` 的 `exportCSV`/`participants` 显式 `limit=10000`，与 `db.js` 无上限仍有理论差异；本轮造数最大 40 人，未覆盖 |
| R8 | `plain:true` 回退开关需手动在代码里开启（无 UI） | 设计如此 | PRD/设计已明确「留在代码里默认关闭」，非缺陷 |
| R9 | Turso 云端真实库 | **未触碰** | 按禁令，所有测试使用隔离本地 SQLite / `file:` 模式 libSQL / 内存 mock |

---

## 7. 人工真机验收清单（需用户配合）

> 建议部署到测试域名后，用**后台真实 UI** 操作（不要在临时 HTML 上验收），确保覆盖前端 `admin.js` 的调用链。

1. **Excel / WPS 双开 `.xls`**：后台 → 名单弹窗 →「导出发言顺序」→ 下载 → 分别用 Microsoft Excel 与 WPS 打开，确认：
   - **区分两种情形**：Excel 2007+ 因文件头嗅探通常会弹一次「文件格式与扩展名不一致」的是/否确认 —— 这是设计 §1.2 / R2 已记录的已知取舍（WPS 一般不弹），点「是」后应能正常打开且样式完整；只要**能继续打开**即记为通过。只有**无法继续/直接拒绝打开**才判定为「硬阻断」；
   - 若真机判定为「硬阻断」→ 回传 team-lead 重新拍板，**不要自行改扩展名或格式**；
   - 第 1 行蓝底白字大标题、第 2 行红字表头；
   - A 列「上午 / 下午」纵向合并、「课间休息15分钟」与「午休」跨列合并、底部备注行；
   - 「日期」「分公司」两列为**带边框的空白可填单元格**；
   - 打印预览中列宽/行高正常、无截断。
2. **二维码真机扫码**：在 `localhost`、Render 临时域名、正式域名（若有）三种 origin 下，各对**至少 2 场不同抽签**生成二维码：
   - 微信「扫一扫」、Android 系统相机、iOS 系统相机分别扫；
   - 确认直达 `/?d=<正确 id>`、活动标题正确、**换场不串场**；
   - 若任一不过 → 记录机型/微信版本，并启用 `plain:true` 回退复测。
3. **下载 PNG**：点击「下载二维码 PNG」，确认得到 800×800 合法 PNG、可用图片查看器打开、再次解码仍为正确链接。
4. **视觉**：确认中心是蓝紫金星系（非猫爪/动物）、深色模块为圆点、整体圆形、三个定位角完整；窄屏下卡片 7 个按钮不溢出。
5. **复制链接一致性**：卡片「复制链接」与弹窗「复制链接」、弹窗链接文本、扫码结果四者逐字符一致；剪贴板不可用时 `prompt` 降级正常。
6. **超容量提示**：造超过容量的人数，确认弹窗提示「最多可安排 X 人 / 当前 Y 人 / 超出 Z 人」且**未下载文件**。

---

## 8. 路由判定结论

| 轮次 | 结果 | 路由 |
|---|---|---|
| Round 1（初验 `d11c91c`） | E2E 30/33、XML 36/42、QR 首轮 9/17 → 自修后 E2E **33/33** / XML **42/42** / QR **16/16**；`test:all` 四套全绿、29 对镜像一致 | **QA**（5 项测试代码缺陷自行修复）+ **Engineer**（1 项 P2 半像素原点缺陷，见 §5.3）；主验收结论「通过」 |
| Round 2（正式定点回归，`6a7cfd7` 后） | 6 张 PNG 重新渲染并 ZXing 真解码 **6/6**、jsQR plain **6/6**、882 格模块中心全一致、finder 中间调占比 14.66%→0%；`selftest-qr.js` 9/9、`test:all` 四套全绿、29 对镜像一致、禁改文件零改动 | **`NoOne`**（最终判定，见 §11） |

**最终路由：`NoOne`** —— 对 `d11c91c` 判定的 `Engineer` 项（仅 `public/qr-render.js:264 / :256` 半像素原点）已由工程师在 `6a7cfd7` 修复，并经 QA 两轮定点回归 + 防回归断言入库闭环。**F1 / F2 与 F3 主验收全部通过，0 阻塞缺陷，不阻断交付**。**未进入第 3 轮**（2 轮硬上限）。剩余项均为人工真机验收与已记录的兼容性风险，按 §7 清单执行。

---

## 9. 附录 · 临时产物与复现命令

所有 QA 脚本与产物位于系统临时目录 `C:\Users\ThinkPad\AppData\Local\Temp\qa-lottery-20261106\`，**未写入项目、未修改产品源码、未新增项目依赖、未 push**。

| 文件 | 用途 |
|---|---|
| `qa-e2e.js` / `qa-e2e-results.json` | 独立真实 HTTP 端到端（33 项） |
| `qa-xml.py` / `qa-xml-results.json` | Python ElementTree 解析 `.xls`（42 项） |
| `qr-render-test.html` / `dom.html` | 无头 Chrome 真实渲染 6 组 PNG |
| `qa-qr-final.js` / `qa-qr-final-results.json` | ZXing 主解码 + jsQR 次解码 + 像素级 finder（16 项） |
| `qa-qr-zxing.js` / `qa-qr-diag.js` / `qa-qr-rounded-check.js` | 交叉验证与半像素根因诊断 |
| `qr-render-rounded.js` / `qr-render-rounded-test.html` / `dom-rounded.html` | **仅临时副本**的根因对照实验（未改产品源码） |
| `csv-A-local.csv` / `csv-A-cloudbase.csv` | 双驱动 CSV 原始字节 |
| `schedule-B.xls` / `schedule-inject.xls` / `schedule-A-mixed.xls` / `schedule-gap0.xls` | 真实 HTTP 响应落盘的 `.xls` |
| `qr-0.png` … `qr-5.png` / `qr-*-white.png` / `qr-*-plain.png` | 真实渲染的 800×800 PNG |

复现（示例）：

```bash
# 1) 端到端
cd "$TEMP/qa-lottery-20261106" && node qa-e2e.js
# 2) XML 解析（需先有 schedule-*.xls）
python qa-xml.py
# 3) 二维码真渲染
"$ProgramFiles/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-sandbox \
  --allow-file-access-from-files --virtual-time-budget=10000 --dump-dom \
  "file:///$TEMP/qa-lottery-20261106/qr-render-test.html" > dom.html
# 4) 真解码
node qa-qr-final.js
```

> 报告落盘前已复核：`git status --porcelain` 为空、`HEAD=d11c91c`、工作区干净。本报告为本次唯一新增的项目内文件。

---

## 10. 修复后定点回归（新提交 `6a7cfd7`）

QA 回传 §5.3 的 P2 缺陷后，工程师提交了 `6a7cfd7 fix: 二维码画布原点取整，消除半像素 finder 细缝`，改动 **恰好为 QA 建议的两处 `Math.round(...)`**，并同步了 2 份镜像（另外把本报告一并提交）。QA 随即做了一次**定点回归**（不是第 3 轮全流程循环，仅针对该改动的影响面）。

### 10.1 提交内容核对

```
public/qr-render.js:256   drawModules(..., cx - LPlain/2, cy - LPlain/2, ...)
                       →  drawModules(..., Math.round(cx - LPlain/2), Math.round(cy - LPlain/2), ...)
public/qr-render.js:264   var ox = cx - L/2, oy = cy - L/2;
                       →  var ox = Math.round(cx - L/2), oy = Math.round(cy - L/2);
```
`cloudbase/hosting/qr-render.js` 与 `cloudbase/function/public/qr-render.js` 同步改动；三份文件 SHA-256 完全相同（`c96131aa…06fc82d8416`）。

### 10.2 回归结果（全部通过）

| # | 校验项 | 结果 |
|---|---|---|
| 1 | `npm run test:all` 四套 | 全绿（local / cloudbase / HTTP 桥接 / 真实 HTTP local+turso） |
| 2 | `node selftest-schedule.js` / `node selftest-qr.js` | 20/20、7/7 |
| 3 | 三份 `qr-render.js` `node --check` | 全部通过 |
| 4 | `npm run build:cloudbase` 重跑 + `git status --porcelain` | 空（干净） |
| 5 | 29 对主文件→镜像 SHA-256 | 0 不一致 |
| 6 | **ZXing 真解码（修复后重新渲染 6 张 PNG）** | 装饰版 **6/6**、plain **6/6**，逐字符等于 `makeShareUrl`，3 origin × 2 id 不串场（无回归） |
| 7 | **jsQR plain 回退版** | **5/6 → 6/6**（M=41 的 `https://lottery-qa.onrender.com/?d=Zm9vYmFyLTIwMjY` 由 `null` 变为正确解码，原失败断言已转为通过） |
| 8 | jsQR 装饰版 | 1/6 → **2/6**（与 §5.3 对照实验预测一致；剩余 4 项为 jsQR 对深色中心星空盘/圆点的二值化敏感性，非本次修复范围） |
| 9 | **finder 细缝定量消除** | 见下表 |

**finder 模块边界亮度**（左上 finder 首行相邻深色模块边界 ±2px 窗口内最亮值，深色墨 `#0B1026` 亮度 ≈ 17，细缝越亮越差）：

| PNG | M | 旧原点 | 修复前 | 修复后 |
|---|---|---|---|---|
| #0 | 33 | ox=154（整数） | 17 | 17（无回归） |
| #1 | 37 | ox=152.5（半像素） | **75.7** | **17** |
| #2 | 37 | ox=152.5 | **75.7** | **17** |
| #3 | 41 | ox=155（整数） | 17 | 17（无回归） |
| #4 | 37 | ox=152.5 | **75.7** | **17** |
| #5 | 37 | ox=152.5 | **75.7** | **17** |

4 个半像素命中项的细缝亮度由 75.7 降至 17（与实心模块一致），2 个原本整数原点项无变化 —— **修复精准命中根因，未引入回归**。

### 10.3 更新后的路由判定

- 对 `d11c91c`：`Engineer`（1 项 P2），**已闭环**。
- 对**当前 HEAD `6a7cfd7`**：**`NoOne`** —— 自动化验收全绿，无待修源码缺陷。
- §6 的遗留风险中 **R4（半像素原点）已消除**；R3（jsQR 装饰版兼容性 2/6）与 R1 / R2 / R5 / R6 仍保留，需按 §7 人工真机验收清单处理。
- 工作区状态：本节更新使本报告成为唯一未提交修改（` M docs/QA-增量验收报告.md`）；产品源码**零改动**。`6a7cfd7` 与 `d11c91c` 均**未 push**。

---

## 11. 第 2 轮定点回归（最终轮 · 防回归固化）

主理人在 QA 回传 §5.3 的 P2 缺陷、工程师提交 `6a7cfd7` 后，正式启动第 2 轮定点回归。本轮目标：证明修复有效、把防护固化进测试、全量回归、更新报告并提交。**按 2 轮硬上限，本轮为最后一轮，未进入第 3 轮。**

### 11.1 本轮改动范围（只改测试文件与报告）

| 文件 | 改动 | 性质 |
|---|---|---|
| `selftest-qr.js` | 新增 2 条防回归测试（7 项 → **9 项**） | 测试文件，QA 职责范围 |
| `docs/QA-增量验收报告.md` | 追加本章 + 同步 §0 / §6-R4 / §8 | 报告 |

**产品源码零改动**；`selftest-qr.js` 不在 `public/` 也不在 `build-cloudbase.js` 复制范围，故不影响 29 对镜像 SHA-256 断言（本轮仍额外重跑了一次 `build:cloudbase` 复核，结果一致）。

**防回归断言设计（采纳工程师与主理人的避坑提示）**：

- ❌ 不用「全文件恰好 4 处 `Math.round`」：`public/qr-render.js:118` 的 `drawStarfield` 原有 `Math.round(d * 2)` 与画布原点无关，全文件共 **5 处** `Math.round`，全局计数会误报。
- ✅ 精确匹配 4 个表达式，各断言出现 1 次，且**主文件 + 2 份镜像都查**：`Math.round(cx - LPlain / 2)` / `Math.round(cy - LPlain / 2)` / `Math.round(cx - L / 2)` / `Math.round(cy - L / 2)`。
- ✅ 同一条测试顺带断言三份文件 QR 层仍 `clip(` 计数为 0、无 `destination-out`，并显式反证 `Math.round(d * 2)` 仍在（说明不能用全局计数）。
- ✅ 几何断言抗重构：用真实 vendor 编码器先确认 `M=33/37/41/57` 均由真实 URL 可达，再按产品同一公式复算 `SIZE=800 / PAD=24 / QUIET=4` 几何，断言命中版本**未取整值确为半像素**（152.5 / 32.5 / 42.5）、**取整后为整数且等于期望**（153 / 33 / 43）；另列 3 个本已整数的对照版本（154 / 155 / 140）确认断言不会假阳性。

| 版本 | 模式 | 未取整原点 | 取整后 | 命中 |
|---|---|---|---|---|
| M=37 | 装饰版 | 152.5 | **153** | 是 |
| M=41 | plain | 32.5 | **33** | 是 |
| M=57 | plain | 42.5 | **43** | 是 |
| M=33 | 装饰版 | 154（整数） | 154 | 否（对照） |
| M=41 | 装饰版 | 155（整数） | 155 | 否（对照） |
| M=57 | 装饰版 | 140（整数） | 140 | 否（对照） |

**断言有效性反证**：把 4 个取整表达式替换回未取整形式生成临时副本（未改产品源码），仍存在的取整表达式数为 **0** → 新增断言必然失败，证明它真能抓到旧 Bug，不是恒真断言。`node selftest-qr.js` 实测 **9/9 通过**。

> 覆盖观察（不擅自改配置）：`selftest-qr.js` / `selftest-schedule.js` 目前**未接入 `package.json` 的 `test:all`**（`test:all` = `npm test` + `test:cloudbase` + `test:http` + `test:server`），需显式 `node selftest-qr.js` 才会跑到新增断言。因 `package.json` 属本轮禁改文件，未擅自改动；建议后续迭代由主理人决定是否把两个 selftest 并入 `test:all`（一行 scripts 变更，需同步评估影响面）。

### 11.2 重新渲染与真解码（修复前后对照）

沿用第 1 轮链路：无头 Chrome `--dump-dom` 打开系统临时目录 HTML，`file://` 加载项目真实 `vendor/qrcode.js` + `share-url.js` + `qr-render.js`，取 `LotteryQR.toDataURL()` 的 800×800 PNG；合成白底后用 ZXing（主）+ jsQR（次）解码。第 2 轮产物 `dom-round2.html` / `round2-*.png`。

| 指标 | 第 1 轮（`d11c91c` 修复前） | 第 2 轮（`6a7cfd7` 修复后） | 判定 |
|---|---|---|---|
| ZXing 装饰版真解码 | 6/6 | **6/6** | 无回归 |
| ZXing `plain:true` | 6/6 | **6/6** | 无回归 |
| **jsQR `plain:true`（关键失败断言）** | **5/6**（M=41 返回 `null`） | **6/6** | **修复生效** |
| jsQR 装饰版 | 1/6 | **2/6** | 有提升；剩余为 jsQR 二值化对深色中心盘敏感，非本次修复范围 |
| 逐字符等于 `makeShareUrl` / 不串场 | 6/6 | **6/6** | 通过 |
| 模块中心像素与 QR 矩阵逐格一致 | 6×147=882 | **6×147=882 全一致** | 通过 |

关键单条：`plain:true` 的 `https://lottery-qa.onrender.com/?d=Zm9vYmFyLTIwMjY`（M=41，原 `raw ox=32.5`）由 `null` 恢复为正确解码，jsQR 返回该 URL 原文。

### 11.3 finder 抗锯齿细缝定量对比（修复的直接视觉证据）

度量：三个 7×7 finder 的像素矩形内，统计**非黑 / 非白中间调像素**（亮度 60–200；墨色 ≈17、白底 ≈255）占区域总像素的比例；另统计左上 finder 首行 6 条模块边界 ±1px 窗口内的细缝像素数。

| PNG | M | 旧原点 | 中间调占比（修复前 → 修复后） | 中间调像素数 | 细缝像素 |
|---|---|---|---|---|---|
| #0 | 33 | ox=154（整数，对照） | 0% → **0%** | 0 → 0 / 21168 | 0 → 0 |
| #1 | 37 | **ox=152.5** | **14.66% → 0%** | **2607 → 0** / 17787 | **6 → 0** |
| #2 | 37 | **ox=152.5** | **14.66% → 0%** | **2607 → 0** / 17787 | **6 → 0** |
| #3 | 41 | ox=155（整数，对照） | 0% → **0%** | 0 → 0 / 14700 | 0 → 0 |
| #4 | 37 | **ox=152.5** | **14.66% → 0%** | **2607 → 0** / 17787 | **6 → 0** |
| #5 | 37 | **ox=152.5** | **14.66% → 0%** | **2607 → 0** / 17787 | **6 → 0** |

4 个半像素命中项细缝完全消失，2 个本已整数的对照项零变化 → **精准命中根因、无回归**。（另用「模块边界最亮值」复核：75.7 → 17，见 §10.2，与本节结论一致。）

### 11.4 全量回归

| # | 校验项 | 结果 |
|---|---|---|
| 1 | `npm run test:all` 四套 | 全绿（local / cloudbase / HTTP 桥接 / 真实 HTTP local+turso） |
| 2 | `node selftest-schedule.js` | 20/20 |
| 3 | `node selftest-qr.js` | **9/9**（含新增 2 项防回归） |
| 4 | 相对增量基线 `3d293b8` 的全部改动 `.js` + `selftest-qr.js` `node --check` | 全部通过 |
| 5 | `npm run build:cloudbase` 重跑后 29 对主文件→镜像 SHA-256 | **0 不一致** |
| 6 | 禁改文件零改动（相对 `3d293b8`）：`package.json` / `package-lock.json` / `Dockerfile` / `render.yaml` / `public/index.html` / `user.js` / `user.css` / `cosmic-bg.js` / `build-cloudbase.js` / `cloudbase/function/package.json` | `git diff` 为空 |
| 7 | 项目依赖清单 | root 仅 `@libsql/client`；云函数仅 `@cloudbase/node-sdk`（零新增） |
| 8 | 真实 Turso 云端库写操作 | **无**（全部隔离本地 / `file:` libSQL / 内存 mock） |
| 9 | 临时解码工具位置 | 系统临时目录 `qrtools/`，`--no-save --no-package-lock`，项目依赖零改动 |

### 11.5 最终通过率、遗留风险与人工清单

- **最终通过率**：Round 1 独立断言 **91/91**；Round 2 新增校验（6 组双解码器真解码、882 格模块中心、12 组 finder 定量对比、2 条防回归单测 + 有效性反证）**全部通过**；`test:all` 四套 / 20 项 / 9 项 / 29 对镜像全绿。**合并 0 失败、0 阻塞缺陷。**
- **遗留风险变化**：**R4（半像素原点）已消除**；§8 已把 R4 标记为闭环。其余 **R1（Excel/WPS 双开）、R2（微信 + Android/iOS 相机真机扫码）、R3（jsQR 装饰版 2/6 兼容性）、R5（视觉主观项）、R6（OpenCV 安装超时）、R7（>10000 人）、R8（`plain:true` 无 UI）、R9（未触碰真实 Turso）保持不变**。
- **人工真机验收清单（§7）不变**，不因修复而取消。特别是：Excel 2007+ 的「格式与扩展名不一致」确认框仍按「可继续 vs 硬阻断」区分；微信 + 双系统相机仍需 3 origin × ≥2 场抽签验证直达 `/?d=` 且不串场；真机若不过，`plain:true` 回退现已恢复可用（本轮已验证 6/6 可解码）。
- **后续可选优化（非本轮范围，已上报主理人）**：适当提亮或缩小中心星空盘可能进一步提升 jsQR 等局部自适应二值化解码器的识别率；本轮按主理人限定只改一处，未擅自扩大改动面。

### 11.6 最终路由判定

**`NoOne`** —— 修复有效、防回归断言已入库、全量回归全绿、无待修源码缺陷。**本轮为第 2 轮（最后一轮），未进入第 3 轮。** 产品源码零改动；未 push；未新增项目依赖；未写真实云端库。

> 本轮提交：`test: 二维码原点取整防回归断言与第2轮验收结论`（仅 `selftest-qr.js` + 本报告），commit hash 已随验收结论回传主理人。
