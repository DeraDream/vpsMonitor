# VPS Monitor

个人 VPS 补货监控后台。商家 Adapter 与通用引擎分离：Adapter 只负责发现套餐，通用层负责调度、状态机、Telegram 卡片和持久化。

## 运行

本地开发：

```powershell
$env:ADMIN_PASSWORD = "local-password"
$env:TOKEN_ENCRYPTION_KEY = "long-random-local-secret"
npm start
```

打开 `http://127.0.0.1:4173`，浏览器会要求输入用户名 `admin` 和上面的密码。未设置 `ADMIN_PASSWORD` 时仅允许本地无密码开发，不应部署到公网。

Docker 部署：

```bash
cp .env.example .env
# 编辑 .env，替换两个随机密钥
docker compose up -d --build
```

容器采用 `restart: unless-stopped`，数据保存在 `./data` 卷中；Docker 模式更新使用 `docker compose up -d --build`。

若要使用设置页的“在线更新”，应以 Git 工作区配合 systemd 部署（而不是构建后的 Docker 镜像）：

```bash
sudo useradd --system --home /opt/vps-monitor --shell /usr/sbin/nologin vpsmonitor
sudo git clone git@github.com:DeraDream/vpsMonitor.git /opt/vps-monitor
sudo chown -R vpsmonitor:vpsmonitor /opt/vps-monitor
sudo cp deploy/vps-monitor.service /etc/systemd/system/
sudo cp .env.example /etc/vps-monitor.env
sudo systemctl daemon-reload && sudo systemctl enable --now vps-monitor
```

`/etc/vps-monitor.env` 需填写 `ADMIN_PASSWORD` 与 `TOKEN_ENCRYPTION_KEY`。在线更新会执行仅快进的 `git pull` 后退出，systemd 会自动拉起新进程；服务账户必须具备读取 Git 远程仓库的权限。

## Adapter 合约

在 `lib/adapters.mjs` 注册 Adapter。它必须包含异步 `discover({ provider })`，并返回完整套餐目录；每个套餐至少需要：

```js
{
  externalId: "provider-stable-id",
  name: "套餐名",
  available: true,
  quantity: 3,
  specs: "2C / 4GB / 60GB",
  price: "€39.00",
  billingCycle: "year",
  location: "DE · Frankfurt",
  buyUrl: "https://…",
  tags: ["provider", "DE"]
}
```

引擎会校验并标准化数据，按任务间隔调用 Adapter。状态变化规则：缺货→有货发送新卡片；库存变化编辑当前卡片；有货→缺货编辑为售罄；下一次补货开始新的消息周期。

## 安全

- 全站可通过 `ADMIN_PASSWORD` 开启 HTTP Basic Auth；生产环境必须设置，或在反向代理层另加认证。
- Bot Token 只能在设置了 `TOKEN_ENCRYPTION_KEY` 后保存，并以 AES-256-GCM 加密写入 `data/store.json`。
- `.env` 和 `data/` 已被 Git 忽略，勿提交密钥或数据库。

## 测试

```bash
npm test
```

测试覆盖套餐模型校验、一次补货周期只通知一次、库存更新、售罄编辑和新的补货周期。
