#!/usr/bin/env bash
# 安装「以 root 运行后台服务」所需的受限助手（需要 sudo 运行一次）
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 sudo 运行：sudo bash scripts/setup-root.sh" >&2
  exit 1
fi
USER_NAME="${SUDO_USER:-}"
if [ -z "$USER_NAME" ] || [ "$USER_NAME" = root ]; then
  echo "无法确定普通用户名（SUDO_USER），请用 sudo -u 你的用户名 执行" >&2
  exit 1
fi
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 0755 "$SRC_DIR/dsh-service" /usr/local/sbin/dsh-service
install -m 0755 "$SRC_DIR/dsh-fix-owner" /usr/local/sbin/dsh-fix-owner
cat > /etc/sudoers.d/dsh-desktop-root <<SUDOERS
$USER_NAME ALL=(root) NOPASSWD: /usr/local/sbin/dsh-service, /usr/local/sbin/dsh-fix-owner
SUDOERS
chmod 0440 /etc/sudoers.d/dsh-desktop-root
visudo -cf /etc/sudoers.d/dsh-desktop-root >/dev/null
echo "已安装 root 助手与 sudoers 规则。"
echo "下一步：客户端 设置 → 勾选「以 root 运行服务」→ 重启后台服务。"
echo "切回普通模式前可在诊断面板执行「修复 dsh 文件属主」。"
