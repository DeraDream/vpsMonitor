# VPS Monitor

自部署的 VPS 套餐与库存监控工具，支持 Bero Host、GreenCloud 和 Telegram 通知。

## 主要功能

- **公开展示页**：无需登录浏览首页、商家、套餐和最新动态；套餐按商家及分类分区展示，提供官网购买入口。
- **监控后台**：管理监控任务，选择全部套餐、分类或指定套餐，设置检查间隔、暂停任务和手动检查。
- **套餐动态**：记录新上架、补货、售罄、库存变化和下架。
- **Telegram 通知**：同一个机器人可同时向频道和个人私聊推送，支持补货、新套餐上架及库存变化通知，可设置北京时间免打扰时段。
- **账户设置**：后台登录、修改密码；前台可进入后台，后台可一键返回前台。
- **版本更新**：检查新版本，确认后显示更新进度，完成后自动重启服务并刷新页面。

## 安装

推荐使用 [GitHub Releases](https://github.com/DeraDream/vpsMonitor/releases/latest) 中的 Linux x64 安装包，已包含网页和运行依赖。

运行环境：Linux x64，Node.js 22.5 或以上。以下安装步骤适用于使用 systemd 的 Debian / Ubuntu。

1. 下载同一版本的 `vps-monitor-版本号-linux-x64.tar.gz` 和 `SHA256SUMS`，放入同一目录。
2. 校验并解压安装包（将命令中的版本号替换为实际下载版本）：

   ```bash
   sha256sum -c SHA256SUMS
   tar -xzf vps-monitor-1.7.0-linux-x64.tar.gz
   cd vps-monitor-1.7.0
   sudo ./deploy/install-release.sh
   ```

3. 编辑运行配置：

   ```bash
   sudo nano /etc/vps-monitor.env
   ```

   | 配置项 | 用途 |
   | --- | --- |
   | `ADMIN_USERNAME` | 管理员用户名，默认 `admin` |
   | `ADMIN_PASSWORD` | 初始登录密码，请设置自己的密码 |
   | `TOKEN_ENCRYPTION_KEY` | Telegram 凭据加密密钥，请设置随机长字符串并妥善保存 |
   | `HOST` / `PORT` | 监听地址和端口，默认 `127.0.0.1:4173` |
   | `AUTH_ORIGIN` | 使用 HTTPS 反向代理时填写完整站点地址，例如 `https://vps.example.com` |

4. 启动并检查服务：

   ```bash
   sudo systemctl restart vps-monitor-api vps-monitor-worker
   sudo systemctl status vps-monitor-api vps-monitor-worker
   ```

安装位置为 `/opt/vps-monitor`，数据库保存在该目录下的 `data/`。默认仅允许本机访问，请配置反向代理转发至 `127.0.0.1:4173`，再通过自己的域名访问。

## 开始使用

打开站点即可浏览公开页面。点击右上角“登录”进入后台，在“设置”中配置 Telegram Bot Token、频道 Chat ID 和通知选项；频道通知需要将 Bot 设为频道管理员并授予发布消息权限。个人私聊通知需先向同一个 Bot 发送 `/start`，再填写自己的数字 User ID。频道和个人通知可分别开关，保存后可独立测试；无需第二个 Token，暂不支持私聊管理命令。

后台“设置 → 修改密码”可更换管理员密码。修改后新密码持续有效，其他登录会话失效。

升级时，在后台“设置 → 版本状态”点击“检查更新”，发现新版本后确认更新即可。请定期备份 `data/` 和 `/etc/vps-monitor.env`，升级时保留原来的加密密钥。
