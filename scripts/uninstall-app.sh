#!/usr/bin/env bash
# 卸载桌面客户端（不删除 dsh 运行时与会话数据）。
set -euo pipefail

APP_ROOT="${DSH_DESKTOP_APP_ROOT:-$HOME/.local/opt/dsh-desktop}"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_ROOT="$HOME/.local/share/icons/hicolor"

echo "==> 删除 $APP_ROOT"
rm -rf "$APP_ROOT"
rm -f "$BIN_DIR/dsh-desktop"
rm -f "$DESKTOP_DIR/dsh-desktop.desktop"
rm -f "$ICON_ROOT"/*/apps/dsh-desktop.png
rm -f "$HOME/.config/autostart/dsh-desktop.desktop"
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
gtk-update-icon-cache -q "$ICON_ROOT" >/dev/null 2>&1 || true

echo "==> 如需一并移除免密升级助手（root）："
echo "    sudo rm -f /usr/local/sbin/dsh-update /etc/sudoers.d/dsh-desktop-updater"
echo "完成（配置目录 ~/.config/dsh-desktop 保留）"
