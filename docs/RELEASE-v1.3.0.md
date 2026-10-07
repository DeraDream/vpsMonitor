Bero Host 全量套餐监控与稳定性修复。

- 自动监控 Bero Host Ryzen VPS / KVM Rootserver，按官网动态发现全部套餐，新套餐自动纳入，默认 60 秒轮询。
- 两个系列使用独立入口和页签，查看、选择及通知均保留系列信息；单页故障保留上次状态。
- 修复监控编辑、通知重复和过期投递、Worker 重启、设置预览、事件列表、心跳和移动端显示。
- 加强设置字段校验、Token 迁移加密和 Telegram 错误处理。

发布附件在本地构建，GitHub Actions 未参与打包。

`vps-monitor-1.3.0-linux-x64.tar.gz` 包含预构建前端、API/Worker 和生产依赖；要求 Linux x64、Node.js 22.5+。无需重新执行 npm 安装或前端构建。

下载 tar.gz 和 SHA256SUMS 后执行 `sha256sum -c SHA256SUMS`，解压后按包内 `docs/RELEASE-INSTALL.md` 运行或安装 systemd 服务。

验证：46 项后端测试、24 项浏览器检查通过；发布包解压后验证 API/Worker、认证、前端资产、版本一致性和 SHA256。

本次未发布 Docker / GHCR 镜像。API 与 Worker 使用相同数据目录及 TOKEN_ENCRYPTION_KEY。
