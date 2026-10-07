# VPS Monitor 1.2

个人 VPS 补货监控后台。1.2 将原来的单文件 Node 服务重构为 **Vue 前端 + API + Worker + SQLite**，但保留现有页面功能和监控状态机行为。

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
- `packages/adapters`：商家 Adapter 注册中心
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

## Docker 安装

```bash
cp .env.example .env
# 修改 ADMIN_PASSWORD / TOKEN_ENCRYPTION_KEY
docker compose up -d --build
```

发布后也可直接使用 GitHub Actions 生成的 GHCR 镜像：

```bash
docker compose pull
docker compose up -d
```

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

## GitHub Actions

`.github/workflows/build.yml` 在 PR / main push 时：

1. 安装依赖
2. 运行语法检查与测试
3. 构建 Vue 前端
4. 生成 `vps-monitor-linux.tar.gz` artifact
5. main/tag push 时构建并推送 `ghcr.io/deradream/vpsmonitor`

## 测试

```bash
npm run check
npm test
npm run build:web
```
