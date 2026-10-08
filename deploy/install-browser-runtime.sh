#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-monitor}"
if [ "$(id -u)" -ne 0 ]; then echo "请使用 root 安装浏览器运行环境" >&2; exit 1; fi
apt-get update
apt-get install -y python3-venv xauth
if ! command -v google-chrome >/dev/null 2>&1; then
  chrome_deb="$(mktemp /tmp/google-chrome.XXXXXX.deb)"
  trap 'rm -f "$chrome_deb"' EXIT
  curl --fail --location --retry 3 https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb --output "$chrome_deb"
  apt-get install -y "$chrome_deb"
fi
if [ ! -x "$INSTALL_DIR/.venv/bin/python" ]; then python3 -m venv "$INSTALL_DIR/.venv"; fi
"$INSTALL_DIR/.venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$INSTALL_DIR/packages/adapters/browser-requirements.txt"
mkdir -p "$INSTALL_DIR/data/browser-profiles/vmiss"
chown -R vpsmonitor:vpsmonitor "$INSTALL_DIR/.venv" "$INSTALL_DIR/data/browser-profiles"
runuser -u vpsmonitor -- "$INSTALL_DIR/.venv/bin/python" -m camoufox fetch
