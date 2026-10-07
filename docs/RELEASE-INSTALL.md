# Release 安装包

本地构建并上传 GitHub Release 的 `vps-monitor-1.3.0-linux-x64.tar.gz` 包含前端成品、API、Worker、生产依赖和 systemd 配置。不包含 Node.js、Git 元数据、数据库、密码或 Telegram Token。

要求 Linux x64、Node.js 22.5+。下载 tar.gz 和 SHA256SUMS 到同一目录后：

```bash
sha256sum -c SHA256SUMS
tar -xzf vps-monitor-1.3.0-linux-x64.tar.gz
cd vps-monitor-1.3.0
```

## 手动运行

```bash
cp .env.example .env
# 修改 .env 中的 ADMIN_PASSWORD 和 TOKEN_ENCRYPTION_KEY
node --env-file=.env apps/api/src/server.mjs
```

另开终端，在同一目录运行：

```bash
node --env-file=.env apps/worker/src/worker.mjs
```

默认监听 127.0.0.1:4173；访问用户名 admin，密码使用 .env 中配置的值。外部访问需配置反向代理或 SSH 转发。

## systemd 安装

Debian/Ubuntu 可在解压目录执行：

```bash
sudo ./deploy/install-release.sh
sudo nano /etc/vps-monitor.env
sudo systemctl restart vps-monitor-api vps-monitor-worker
```

安装目录固定为 `/opt/vps-monitor`。该脚本使用包内文件，不克隆仓库、不运行 npm 安装、不构建前端；已有 `/etc/vps-monitor.env` 和 data 目录保留。

## 升级

升级前停止 API 和 Worker，并备份 data 目录及环境配置。下载新版本的本地构建包、验证校验和、解压并再次执行安装脚本，然后重启服务。必须保留原 TOKEN_ENCRYPTION_KEY，否则已有加密 Telegram Token 无法解密。

Release 安装包没有 `.git`，页面中的 Git 在线更新不可用；通过新安装包升级。源码 Git 安装仍可使用 Git 更新。本次发布不生成或推送 Docker / GHCR 镜像。
