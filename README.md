# VPS Monitor

自部署的 VPS 套餐与库存监控工具，支持 Bero Host、GreenCloud 和 Telegram 通知。

## 主要功能

- **公开展示页**：无需登录浏览首页、商家、套餐和最新动态；套餐按商家及分类分区展示，提供官网购买入口。
- **监控后台**：管理监控任务，选择全部套餐、分类或指定套餐，设置检查间隔、暂停任务和手动检查。
- **套餐动态**：记录新上架、补货、售罄、库存变化和下架。
- **Telegram 通知**：同一个机器人可同时向频道和个人私聊推送，支持补货、新套餐上架及库存变化通知，可设置北京时间免打扰时段。
- **账户设置**：密码和 Passkey 登录、多设备凭证管理、修改密码；前台可进入后台，后台可一键返回前台。
- **版本更新**：检查新版本，确认后显示更新进度，完成后自动重启服务并刷新页面。

## 安装

推荐使用 [GitHub Releases](https://github.com/DeraDream/vpsMonitor/releases/latest) 中的 Linux x64 安装包，已包含网页和运行依赖。

运行环境：Linux x64，Node.js 22.5 或以上。以下安装步骤适用于使用 systemd 的 Debian / Ubuntu。

1. 下载同一版本的 `vps-monitor-版本号-linux-x64.tar.gz` 和 `SHA256SUMS`，放入同一目录。
2. 校验并解压安装包（将命令中的版本号替换为实际下载版本）：

   ```bash
   sha256sum -c SHA256SUMS
   tar -xzf vps-monitor-1.8.0-linux-x64.tar.gz
   cd vps-monitor-1.8.0
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

打开站点即可浏览公开页面。点击右上角“登录”进入后台，在“设置”中配置 Telegram Bot Token、频道 Chat ID 和通知选项；频道通知需要将 Bot 设为频道管理员并授予发布消息权限。个人私聊通知需先向同一个 Bot 发送 `/start`，再填写自己的数字 User ID。频道和个人通知可分别开关，保存后可独立测试；无需第二个 Token；配置的个人 User ID 同时是唯一管理员，在 Bot 私聊发送 `/menu` 可管理监控、查询库存和调整通知。

后台“设置 → 修改密码”可更换管理员密码。修改后新密码持续有效，其他登录会话失效。

升级时，在后台“设置 → 版本状态”点击“检查更新”，发现新版本后确认更新即可。请定期备份 `data/` 和 `/etc/vps-monitor.env`，升级时保留原来的加密密钥。

### Passkey 与 Telegram 私聊管理

设置 `AUTH_ORIGIN=https://你的域名`，通过具有浏览器信任证书的 HTTPS 域名访问后台。
在设置页的 Passkey 登录区域输入当前密码，添加设备凭证；支持多设备、重命名和删除。
登录页支持 Passkey 和密码登录。普通 HTTP 禁用 Passkey，不会生成自签名证书。
Passkey 绑定注册时的域名，迁移域名后应使用密码登录并重新添加凭证。
删除 Passkey 会撤销其他登录会话；密码修改不会自动删除设备凭证，遗失设备请单独删除。

Telegram 设置中的个人 User ID 同时是唯一 Bot 管理员。只允许该用户在私聊管理，
无需绑定或多用户账户。管理菜单与个人通知开关独立；清空此 ID 即停用私聊管理。
私聊发送 `/menu`，可查看系统状态、管理监控、查询库存、调整通知和查看最近事件。
`/quiet 23:00 08:00` 设置北京时间免打扰时段；管理回复不受免打扰影响，通知与测试消息仍遵守免打扰。
删除和批量暂停需要在两分钟内确认。Bot 使用 Worker 长轮询，持久化消息进度；
已有 Webhook 的 Bot 会报告冲突，不会自动删除原有 Webhook。

Bot 管理菜单使用 HTML 卡片排版，按钮导航直接更新原消息。检查间隔支持快捷选项和自定义输入：
监控详情 → 检查间隔 → 自定义，发送 `75`、`75秒`、`5m` 或 `5分钟`；范围为 30–3600 秒的整数，
输入状态 5 分钟内有效，`/cancel` 或切换菜单可取消。套餐列表按页编号，与购买按钮一一对应。

### 动态与服务日志

前后台补货动态共用按北京时间日期分组的时间线，每批加载 30 条，滚动到底部继续加载，可按上架、补货、售罄、库存变化和下架筛选。后台日志页读取本机 systemd 的 API 与 Worker 日志，每 2 秒增量刷新，默认自动滚动，可暂停与恢复；日志接口需要后台认证。API 服务需要 `SupplementaryGroups=systemd-journal`（已加入 systemd 模板）。日志首屏读取最近 200 条，屏幕内最多保留 1000 条。

后台补货动态右上角可保存统一刷新间隔（默认 10 秒，1–3600 秒），写入数据库后前后台共享。前台只有读取权限；已经打开的页面会在 10 秒内获取新设置。空列表按当前分类显示“暂无XX状态”。
