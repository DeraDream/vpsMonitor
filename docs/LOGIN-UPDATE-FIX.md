# 登录与安装包版本检查修复（1.3.1）

当前 VPS 已升级至 1.3.1，地址保持 http://94.249.174.47:4173，登录凭据和监控数据保留。

安装包没有 .git，因此改为异步查询 GitHub 的最新正式 Release 并比较版本号；保留源码部署的 Git 更新流程。安装包发现新版后提供发布包入口，明确通过安装包升级，不允许执行 Git 拉取。当前 GitHub 最新正式发布为 1.3.0，线上 1.3.1 会显示高于已发布版本。这次未推送或发布 GitHub 新版本。

浏览器使用独立登录页和七天 Cookie 会话。会话令牌随机生成，仅保存哈希，HttpOnly、SameSite=Strict；HTTPS 配置 AUTH_ORIGIN 后添加 Secure。会话持久化，退出立即失效，修改环境中的密码并重启后旧会话失效。登录有来源校验和每分钟十次尝试限流。保留 API 的 Basic 请求兼容，但不再发送 WWW-Authenticate，浏览器不会弹出系统认证框。

登录页包含错误提示、密码显示开关、登录中反馈、手机适配及退出登录；会话失效后回到登录页。沿用环境中的 ADMIN_PASSWORD，ADMIN_USERNAME 默认 admin。未新增用户名或密码复杂度规则。按用户最新指示不实现 Passkey，相关依赖及试验代码已移除。

自测：48 项后端测试、11 项登录浏览器检查、14 项控制台回归、10 项 Bero 系列回归全部通过。安装包解压运行验证通过；公网地址浏览器登录、版本检查、刷新及退出共六项验证通过，未触发弹窗或页面异常。证据见 test-results/v1.3.1。浏览器回归中的 HTTP 400 来自刻意触发未安装测试 Adapter 的探测失败，属于预期反馈。

升级前完整安装备份保存在 releases/installed-backup-1791379746.tar.gz（仅 root 可读，Git 忽略）。当前安装目录 /opt/vps-monitor，配置 /etc/vps-monitor.env，systemd 服务 vps-monitor-api 和 vps-monitor-worker 均 active、enabled。
