#!/usr/bin/env bash
set -euo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-monitor}"
if [ "$(id -u)" -ne 0 ]; then echo "请使用 sudo 执行此安装脚本" >&2; exit 1; fi
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<5)){console.error("需要 Node.js 22.5+");process.exit(1)}'
if [ "$INSTALL_DIR" != /opt/vps-monitor ]; then echo "随包 systemd 配置要求安装目录 /opt/vps-monitor" >&2; exit 1; fi
test -f "$RELEASE_DIR/apps/web/dist/index.html"
test -d "$RELEASE_DIR/node_modules"
id -u vpsmonitor >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin vpsmonitor
mkdir -p "$INSTALL_DIR"
if [ "$RELEASE_DIR" != "$INSTALL_DIR" ]; then
  tar -C "$RELEASE_DIR" --exclude='./data' --exclude='./.env' --exclude='./.git' -cf - . | tar -C "$INSTALL_DIR" -xf -
fi
mkdir -p "$INSTALL_DIR/data"
chown -R vpsmonitor:vpsmonitor "$INSTALL_DIR"
bash "$INSTALL_DIR/deploy/install-browser-runtime.sh"
if [ ! -f /etc/vps-monitor.env ]; then
  cp "$INSTALL_DIR/.env.example" /etc/vps-monitor.env
  chmod 600 /etc/vps-monitor.env
fi
cp "$INSTALL_DIR/deploy/systemd/vps-monitor-api.service" /etc/systemd/system/
cp "$INSTALL_DIR/deploy/systemd/vps-monitor-worker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable vps-monitor-api vps-monitor-worker
echo "本地构建包安装完成，无需 npm install 或前端构建。"
echo "配置 /etc/vps-monitor.env 后执行：sudo systemctl restart vps-monitor-api vps-monitor-worker"
