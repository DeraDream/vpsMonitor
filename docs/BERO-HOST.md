# Bero Host 接入与验收

日期：2026-10-07。

## 已完成

- 独立模块：`packages/adapters/src/bero-host/`，共用解析器，分别抓取 [Ryzen VPS](https://bero-host.de/server/prepaid-ryzen-vserver-mieten) 和 [KVM Rootserver](https://bero-host.de/server/prepaid-kvm-rootserver-paket-mieten)。
- 每次动态发现套餐，生产代码未写死套餐名称、数量或套餐数字 ID。
- 每张卡片的 `selectPackage(ID)` 提供稳定识别，最终 ID 为 `bero-host:ryzen:ID` 或 `bero-host:kvm:ID`，同名或同数字 ID 不会跨系列冲突。
- 在卡片标题区域之外识别 `Ausverkauft` / `Sold out` 标记；正常结构且无售罄/禁用/变淡异常时判断为页面有货；异常结构拒绝更新，不通过整页关键词猜测库存。
- 只 GET 两个公开页面，不选择套餐、不提交订单。15 秒请求超时。
- 首次接入自动建立启用的全部监控，默认 60 秒。新套餐自动纳入；删除或暂停后尊重用户设置。
- 成功系列按当前列表展示；已消失套餐保留历史但从当前列表移除，不转成售罄。失败系列保留上次状态、显示错误，恢复后再更新。
- 商家卡片有两个独立系列入口；套餐查看和监控选择使用 Ryzen / KVM 页签，同时只展示一个系列。切换保留跨系列选项，也可选择一个系列全部套餐。
- TG 通知包含系列名称。网站没有明确剩余数量，因此 quantity 为 null。

## 实际探测

当前环境 `data/vps-monitor.db` 已初始化 Bero Host，全部监控已启用。本次真实读取两个页面，识别 Ryzen 5 个、KVM 5 个，Ryzen 3 个页面有货，KVM 0 个页面有货。这些是探测时的页面状态，不保证结算可购买，也不预测后续库存。

Worker 已作为当前环境中的会话进程启动，心跳和后续探测已写入数据库，60 秒轮询。未安装 systemd；环境/会话进程终止后需重新执行 `npm run start:worker`。API 页面服务本轮仅用于隔离验收，未常驻启动。当前数据库未配置 Telegram，因此只记录状态和事件，尚未发送真实 TG 消息。

探测时间、最新心跳与分组数量见 [真实探测证据](test-results/bero-host/live-probe.json)。

## 验证

- Node 测试 46 项全部通过，无失败、跳过或 TODO。
- Bero Host 浏览器检查 10 项全部通过。
- 原有浏览器检查 14 项全部通过。
- 语法检查、前端生产构建、Git diff 空白检查通过。
- 验证动态第六套餐、英文售罄、套餐重排、重复 ID、页面结构异常、两页失败、单页失败与恢复、套餐消失再出现、分组选择持久化和手机宽度。
- 日常自动化测试使用剥离会话信息的套餐 HTML 样本，不访问商家网站；另做了一次真实手动探测及当前 Worker 的实际轮询验证。

证据：[Node 输出](test-results/bero-host/node-tests.tap)、[专项浏览器结果](test-results/bero-host/browser-results.json)、[原有浏览器结果](test-results/bero-host/general-browser-results.json)。

界面截图：[Ryzen 独立页签](test-results/bero-host/ryzen-desktop.png)、[KVM 独立页签](test-results/bero-host/kvm-desktop.png)、[手机页签及异常提示](test-results/bero-host/mobile.png)。

```bash
npm run check
npm test
npm run build:web
node scripts/bero-probe.mjs
```

本环境浏览器依赖沿用上一轮 /tmp 中的 Playwright 与 Chromium：

```bash
PLAYWRIGHT_MODULE=/tmp/vpsmonitor-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/vpsmonitor-browsers node scripts/bero-browser-smoke.mjs
```

界面验收使用隔离数据库。此接入验收在发布提交前完成，版本发布说明见 RELEASE-v1.3.0.md。
