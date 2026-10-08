#!/usr/bin/env bash
set -euo pipefail
REPO="${REPO:-git@github.com:DeraDream/vpsMonitor.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-monitor}"
if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]; then echo "需要 Node.js 22+" >&2; exit 1; fi
id -u vpsmonitor >/dev/null 2>&1 || sudo useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin vpsmonitor
if [ ! -d "$INSTALL_DIR/.git" ]; then sudo git clone "$REPO" "$INSTALL_DIR"; fi
sudo chown -R vpsmonitor:vpsmonitor "$INSTALL_DIR"
sudo -u vpsmonitor bash -lc "cd '$INSTALL_DIR' && npm install && npm run build:web && mkdir -p data"
sudo bash "$INSTALL_DIR/deploy/install-browser-runtime.sh"
if [ ! -f /etc/vps-monitor.env ]; then sudo cp "$INSTALL_DIR/.env.example" /etc/vps-monitor.env; sudo chmod 600 /etc/vps-monitor.env; echo "请编辑 /etc/vps-monitor.env 后再启动服务"; fi
sudo cp "$INSTALL_DIR/deploy/systemd/vps-monitor-api.service" /etc/systemd/system/
sudo cp "$INSTALL_DIR/deploy/systemd/vps-monitor-worker.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vps-monitor-api vps-monitor-worker
echo "安装完成。配置 /etc/vps-monitor.env 后执行: sudo systemctl restart vps-monitor-api vps-monitor-worker"
