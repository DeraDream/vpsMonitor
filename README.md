# VPS Monitor 1.4.2

个人 VPS 补货监控后台，使用 **Vue 前端 + API + Worker + SQLite**。支持 Bero Host 的 Ryzen / KVM 套餐和 GreenCloud 的动态分类、库存监控，提供免登录库存展示页、独立后台登录页、配置详情、后台地区筛选和 Telegram 通知。

## 架构

```text
Browser -> Vue 3 (静态构建)
             |
             v
         API :4173 -------- SQLite
                               ^
                               |
                            Worker
                      Scheduler / Adapter / TG
```

目录：

- `apps/web`：Vue 3 + Vite 管理后台
- `apps/api`：HTTP API、静态前端、手动探测、设置和在线更新
- `apps/worker`：定时探测与 Telegram 重试
- `packages/core`：套餐状态机、通知、加密与业务服务
- `packages/adapters`：商家 Adapter 注册中心；每个商家独立文件夹（`src/bero-host`、`src/greencloud`）
- `packages/db`：SQLite 持久化与旧 `store.json` 自动迁移

Node.js 要求 **22.5+**（使用内置 `node:sqlite`）。

## 本地开发

```bash
npm install
cp .env.example .env
npm run build:web
ADMIN_PASSWORD=local-password TOKEN_ENCRYPTION_KEY=long-random-secret npm run start:api
```

另开一个终端：

```bash
TOKEN_ENCRYPTION_KEY=long-random-secret npm run start:worker
```

前端开发模式：

```bash
npm run dev:web
```

Vite 会把 `/api` 代理到 `127.0.0.1:4173`。

## Bero Host

已内置 `packages/adapters/src/bero-host/`，分别读取 Ryzen VPS 和 KVM Rootserver 两个公开套餐页。首次启动 API 或 Worker 时自动接入 Bero Host，并创建每 60 秒运行的“全部套餐”监控。已有任务的暂停、间隔和选择不会被启动过程覆盖；手动删除后也不会自动重建。

套餐数量、名称、套餐 ID、配置、价格和售罄状态来自页面，每次完整解析成功后按页面列表更新。新增套餐自动纳入全部监控；消失的套餐退出当前列表，保留历史记录，不冒充售罄。两个系列有独立入口和页签，选择监控时切换页签仍保留已选套餐。通知消息包含系列名称。

单个系列失败时保留其上次状态、显示异常提示并暂停该系列积压通知，另一个系列继续更新；两页均失败时记录探测失败。当前页面未提供剩余台数，所以不会展示虚构库存数量。

可手动探测并写入当前数据库（此命令不发送 TG 消息）：

```bash
node scripts/bero-probe.mjs
```

探测及分组回归说明、截图见 `docs/BERO-HOST.md`。

## Docker 安装

```bash
cp .env.example .env
# 修改 ADMIN_PASSWORD / TOKEN_ENCRYPTION_KEY
docker compose up -d --build
```

本版本通过本地构建并上传 GitHub Release 发布，不由 GitHub Actions 构建镜像。Docker 使用上面的本地构建方式；本次未发布 GHCR 镜像。

数据保存在 `./data/vps-monitor.db`。API 与 Worker 共用同一数据卷。

## systemd 直接安装

Debian/Ubuntu 安装 Node.js 22+ 和 Git 后：

```bash
git clone git@github.com:DeraDream/vpsMonitor.git
cd vpsMonitor
sudo ./deploy/install.sh
sudo nano /etc/vps-monitor.env
sudo systemctl restart vps-monitor-api vps-monitor-worker
```

状态：

```bash
systemctl status vps-monitor-api
systemctl status vps-monitor-worker
```

systemd 模式支持后台“在线更新”：更新流程会执行 fast-forward Git 更新、安装依赖、重新构建 Vue 前端，并让 API/Worker 一起重启。

Docker 模式不在应用内执行 Git 更新，应通过 `docker compose pull && docker compose up -d` 更新镜像。

## 从 1.x 升级

首次启动 1.2 时，如果 `data/store.json` 存在且 SQLite 尚无业务数据，会自动迁移：

- providers
- plans
- monitors
- notifications
- events
- settings
- runtime

完成后旧文件改名为 `data/store.json.migrated`，便于回滚核对。

## Adapter 合约

在 `packages/adapters/src/index.mjs` 注册 Adapter。Adapter 至少包含：

```js
{
  key: "provider-key",
  name: "Provider",
  version: "1.0.0",
  async discover({ provider }) {
    return [{
      externalId: "stable-id",
      name: "套餐名",
      available: true,
      quantity: 3,
      specs: "2C / 4GB / 60GB",
      price: "€39.00",
      billingCycle: "year",
      location: "DE · Frankfurt",
      buyUrl: "https://…",
      tags: ["provider", "DE"]
    }]
  }
}
```

核心状态机保持 1.x 逻辑：缺货→有货创建补货通知；有货期间库存变化编辑原卡片；有货→缺货编辑为售罄；下一次补货开启新的消息周期。

多系列 Adapter 也可返回 `{ plans, completedCategories, failures }`。`plans` 中添加 `categoryId` / `categoryName`；`completedCategories` 只包含成功完整解析的系列，用于更新当前套餐列表；`failures` 包含失败系列 ID、名称及原因。普通 Adapter 返回数组的原有合约继续支持。

通知由 Worker 统一投递，API 手动探测只更新状态并加入通知队列，因此需要同时运行 Worker。关闭 TG 或暂停监控会暂停积压通知，恢复后仅投递仍有效的补货周期；删除监控会清理关联的待投递通知。TG 请求超时为 15 秒，投递任务使用 60 秒 SQLite 租约防止多个进程同时发送；429 和临时错误重试，永久错误记录事件并停止重试。

迁移包含旧明文 Bot Token 的 `store.json` 时，必须配置 `TOKEN_ENCRYPTION_KEY`。迁移会加密 Token，并在本次生成的归档中移除明文；未配置密钥会拒绝迁移并保留原文件，配置后可重新启动。

## 本地打包与发布

```bash
npm ci
npm run check
npm test
npm run build:web
npm run package:release
```

产物位于 `releases/`：预构建前端、API/Worker、生产依赖组成的 Linux 包，以及 SHA256SUMS。发布时推送代码和版本标签，并把本地产物上传到 GitHub Release。打包器拒绝在 GitHub Actions 中运行。

Release 安装包无需重新安装依赖或构建前端，要求 Linux x64 / Node.js 22.5+。安装和升级说明见 [Release 安装指南](docs/RELEASE-INSTALL.md)。源码 Git 安装和 Release 安装两种方式均可使用。

## GitHub Actions

`.github/workflows/build.yml` 只有 `workflow_dispatch` 手动触发；main、标签和 Release 推送不会触发构建或打包。本版本不触发该工作流。

## 测试

```bash
npm run check
npm test
npm run build:web
```

## GreenCloud

绿云从公开商店导航动态发现分类和套餐；数量为零判为缺货，未公开数量时标为可订购，不编造库存。首轮建立库存基线，后续补货和新套餐再通知。默认每 300 秒运行，最多两个并发请求；支持全店、指定分类或指定套餐监控。更多说明见 [docs/GREENCloud.md](docs/GREENCloud.md)。

库存变化通知及北京时间免打扰设置：[使用说明](docs/NOTIFICATIONS.md)。

## 公开展示页

访问站点根路径可直接浏览首页、商家、套餐和动态，无需登录。右上角“登录”进入 `/admin`，登录后使用原控制台。登录会话不影响公开展示。套餐页默认全部 tab，并提供商家 tab；商家区内按官网分类分区，每个分类独立分页并保留购买页链接，公开页面每 30 秒更新数据库展示，不额外触发商家采集。

`GET /api/public/catalog` 是匿名只读接口，仅提供当前商家、未下架套餐及最近 500 条套餐动态。通知凭据、TG 消息目标、监控配置和运行错误不公开；其他后台 API 仍需认证。

新上架、补货、售罄、库存变化、下架才进入套餐动态；不再记录重复的成功探测事件。动态与运行日志分别保留最近 500 条，错误可在监控任务查看。升级之前已经被旧保留策略删掉的历史事件不能恢复。

通知设置中的“新套餐上架通知”默认开启。商家首次采集只建立基线，之后按套餐稳定 ID 自动识别新增，解析配置和购买地址，发送独立 TG 上架卡片；新分类及已经售罄的新套餐也通知。该开关涵盖启用监控商家的所有新套餐，独立于已选套餐的补货范围，并遵守 TG 总开关和免打扰。关闭后继续记录动态，重新开启不批量补发已有套餐。

## 在线更新

后台通知设置中的“检查更新”会显示检查状态和失败原因。有完整的新发布包时自动弹出站内确认框；点“确定更新”才开始下载、SHA256 校验、备份、安装。弹窗展示真实阶段和下载进度，重启期间自动重试连接，服务恢复后自动刷新页面。无需重启整台 VPS。

安装包部署直接使用 GitHub Release 的 Linux x64 包及 SHA256SUMS；源码部署校验 origin 和工作目录后进行 Git 快进更新、依赖安装与前端构建。安装包校验失败不修改部署，安装过程中失败恢复已替换文件。原部署备份保存在数据目录 `update-backups/`；数据库、登录配置与 TG 设置原地保留。更新进度持久化，手动刷新页面可以继续查看；同一时间只允许一个更新任务。详见 [在线更新](docs/ONLINE-UPDATES.md)。
