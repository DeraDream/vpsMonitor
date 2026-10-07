# VPS Monitor 测试报告

本文件保留修复前的测试基线。当前修复与回归结果见 [修复报告](FIX-REPORT.md)。

日期：2026-10-07。基线：main / 028e6db。环境：Node 22.23.3、npm 10.9.9、Chromium / Playwright。

本轮增加测试和报告，未修改业务实现、未提交或推送 Git。所有业务数据均在临时 SQLite 数据库中；模拟商家只用于驱动通用状态机，不访问商家网站或测试真实套餐。Telegram 请求全部模拟，不发送真实消息。浏览器更新状态采用模拟响应；更新接口另有独立假 Git 集成测试。

## 结果

| 检查 | 结果 |
| --- | --- |
| npm ci | 成功；安装时 audit 报告 0 vulnerabilities |
| npm run check | 通过 |
| npm test | 26 项：14 通过、12 已复现待修复问题 |
| 真实浏览器 | 12 项：6 通过、6 失败 |
| npm run build:web | 通过 |
| bash -n deploy/install.sh | 通过 |
| systemd-analyze verify 两个 service | 通过配置验证，未安装或启动 systemd 服务 |

**不能将 npm test 的退出码 0 解读为全部功能正常。** 12 个已知问题用 Node test 的 TODO 标记保留，断言仍执行且失败，输出 `not ok ... # TODO`；用于记录基线而不破坏原有 CI。修复后应删除对应 TODO。浏览器脚本遇到失败返回退出码 1。

原始证据：[Node 测试输出](test-results/node-tests.tap)、[浏览器结果和报错](test-results/browser-results.json)、[桌面截图](test-results/desktop.png)、[手机截图](test-results/mobile.png)。

## 已通过的流程

1. 未登录访问被拒绝，正确 Basic 认证可访问 API 和静态前端。
2. 创建监控、商家重复任务拒绝、未知商家拒绝、空的指定套餐范围拒绝、低于 30 秒间隔被限制。
3. API 编辑任务、删除任务、重复删除返回 404；重启后任务和设置保持。
4. 缺少 Adapter 时手动运行返回错误，连续失败次数和事件正确记录，页面显示失败原因。
5. 模拟完整周期：缺货 → 有货发送；相同状态不重复发送；库存变化编辑同一消息；售罄编辑；再次补货发新消息。
6. Telegram 429 保留任务并遵守 retry_after；下次成功记录 messageId 并清理队列。
7. Token 不通过 API 返回明文；SQLite 中无所测试的明文 Token；加解密成功，随机 IV 生效，错误密钥和无效密文被拒绝。
8. SQLite 重开后数据保留；事件最多保留 500 条；已有数据不会被旧 store.json 覆盖。
9. Worker 心跳持续更新、SIGTERM 能退出；正常运行中收到重启标记能退出。
10. 更新源一致且干净时可检查；工作区脏或 origin 不一致时拒绝；通过假 Git 测试，无真实更新操作。
11. 浏览器概览、创建任务、删除任务、手动失败提示、设置预览和 Telegram 设置保存可用。

## 需要修改的功能（实际复现）

| 优先级 | 问题及影响 | 修改位置与建议 |
| --- | --- | --- |
| P0 | 浏览器点击编辑打不开弹窗，console 出现 DataCloneError | apps/web/src/App.vue：不能直接 structuredClone Vue 响应式 Proxy；先转换为原始对象或建立明确的表单副本 |
| P0 | 两个投递者并发处理同一 job 会发送两次 | packages/core/src/service.mjs、packages/db/src/database.mjs：增加数据库原子领取、租约；建议 Worker 统一投递，API 手动探测只入队 |
| P1 | 积压补货任务在套餐已售罄后仍发送“补货”消息 | service.mjs：给 job 增加补货周期 ID / 状态版本，发送前验证；取消过期任务，明确定义快照与当前状态 |
| P1 | 关闭 TG 后仍投递队列消息 | service.mjs：投递前检查 enabled，明确暂停时保留队列还是取消 |
| P1 | 删除监控后其队列消息仍发送 | service.mjs、database.mjs：job 关联 monitorId；删除时事务清理或标记取消 |
| P1 | Worker 启动前已有 .restart-worker 就崩溃 | apps/worker/src/worker.mjs：timer 初始化前 close 使用它；调整启动和关闭顺序。实际报错 Cannot access 'timer' before initialization |
| P1 | Telegram “message is not modified” 被反复重试 | telegram.mjs、service.mjs：按接口语义将该幂等编辑结果视为完成；区分临时失败和永久失败 |
| P1 | 设置接口允许客户端覆盖 botTokenEncrypted 为无效内容 | apps/api/src/server.mjs：字段白名单，密文只允许服务器生成 |
| P1 | TG enabled 接受字符串 false，后续仍会被当作真值 | server.mjs：严格校验布尔、字符串长度和设置类型 |
| P1 | 旧 JSON 归档原样保留明文 Token | packages/db/src/database.mjs：迁移时加密 Token，明确兼容旧格式并脱敏归档；目前 SQLite 删除旧明文字段，但归档仍包含它 |
| P1 | 过期 1 小时的 Worker 心跳仍显示运行中 | App.vue：按心跳时间差判断在线、离线、未知，增加定时刷新 |
| P1 | 不存在的远端分支仍 deployReady=true、显示最新版本 | server.mjs：remoteRevision 为 null 应拒绝部署并明确显示分支不存在 |
| P2 | 错误 JSON 发给 preview 返回 500 | server.mjs：统一处理 JSON 解析错误为 400，与其他 API 一致 |
| P2 | 消息 tags 未转义 HTML | packages/core/src/telegram.mjs：tags 同样使用 escapeHtml，校验购买链接协议 |
| P2 | 事件页只显示 12 条，本次数据库有 21 条 | App.vue：概览继续使用 12 条；事件页独立请求 /api/events，后续加入分页和筛选 |
| P2 | Bot Token 保存后输入框仍保留明文 | SettingsPage.vue：保存成功后清空；避免以后保存重复提交旧 Token |
| P2 | 购买链接开关保存后预览仍展示旧内容 | SettingsPage.vue：监听设置变化并重取预览；当前只 onMounted 生成 |
| P2 | 390px 手机宽度存在页面横向溢出 | apps/web/src/style.css：检查移动端导航和容器宽度，限制溢出；截图见证据 |

## 建议增加、删除及调整

**增加：** `/api/health` / readiness（数据库、Worker 心跳和队列积压）；通知队列管理（失败原因、重试次数、取消、死信）；请求超时和监控异常退避；SQLite 在线备份、恢复及版本化迁移；事件筛选和分页；界面自动刷新与操作加载状态；首次运行说明与配置校验。

**删除或收敛：** API 中同步投递职责，避免与 Worker 抢队列；设置接口任意字段写入；永久错误无限重试；生产环境依赖 npm install 临时解析版本的更新方式，改为锁文件与 npm ci。

**调整：** 在线更新改为异步作业，增加超时、日志、构建成功后切换和回滚；Git / npm 的 execFileSync 当前阻塞 API。Docker 应明确禁用应用内更新。Dockerfile 应复制 package-lock.json 并使用 npm ci。systemd 安装默认私有 SSH URL，但 vpsmonitor 服务用户未配置本次 root 私钥，后续在线更新认证需要单独处理。`.env` 在本地普通 npm start 下不会自动加载，README 应说明加载方式或使用 Node --env-file。安装脚本目前只检查主版本 ≥22，没有验证 Node 22.5 最低小版本。

这些部署项属于代码审查发现，未在本轮执行真实安装或部署。

## 重现

```bash
npm ci
npm run check
npm test
npm run build:web
bash -n deploy/install.sh
systemd-analyze verify deploy/systemd/vps-monitor-api.service deploy/systemd/vps-monitor-worker.service
```

本环境浏览器依赖放在 /tmp，未加入项目 package.json：

```bash
npm install --prefix /tmp/vpsmonitor-browser --cache /tmp/vpsmonitor-npm-cache playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/vpsmonitor-browsers node /tmp/vpsmonitor-browser/node_modules/playwright/cli.js install chromium
# 系统缺少浏览器库时需要管理员权限安装：
node /tmp/vpsmonitor-browser/node_modules/playwright/cli.js install-deps chromium
PLAYWRIGHT_MODULE=/tmp/vpsmonitor-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/vpsmonitor-browsers node scripts/browser-smoke.mjs
```

浏览器脚本输出结果及截图到 /tmp/vpsmonitor-*，使用临时测试密码和虚构 Token，不包含真实凭证。

## 尚未覆盖的外部验证

- 真实商家 / 套餐按要求排除；当前注册中心没有已注册的生产 Adapter，新安装实例也没有商家初始化流程。
- 未做真实 Telegram 频道发送、权限、网络故障和实际限流验证。
- 当前环境没有 Docker，未运行镜像构建、compose 启动和容器恢复。
- 未安装 systemd 服务、未执行真实 Git 合并和在线更新；更新失败后的回滚尚需部署环境测试。
- 未进行长期压力、断电恢复、网络代理或 HTTPS 反向代理验证。

建议先解决 P0 与通知队列的 P1 项，再做真实部署验收。
