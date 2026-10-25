#!/usr/bin/env bash
# 一次性特权配置（需要 sudo；由安装流程或手动执行）：
#   1. 安装 root 拥有的 /usr/local/sbin/dsh-update 升级助手
#   2. 写入 /etc/sudoers.d/dsh-desktop-updater（仅允许上述脚本免密）
#   3. 给 Electron 的 chrome-sandbox 设置 setuid root（启用 Chromium 沙箱）
#
# 用法: sudo bash scripts/setup-privileged.sh <项目scripts目录> <用户名> [chrome-sandbox路径]
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 sudo 运行: sudo bash $0 ..." >&2
  exit 1
fi

SRC="${1:?缺少项目 scripts 目录参数}"
TARGET_USER="${2:?缺少用户名参数}"
SANDBOX="${3:-}"

if [[ ! -f "${SRC}/dsh-update.sh" ]]; then
  echo "缺少 ${SRC}/dsh-update.sh" >&2
  exit 1
fi
if [[ ! "${TARGET_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "用户名不合法: ${TARGET_USER}" >&2
  exit 1
fi

install -o root -g root -m 0755 "${SRC}/dsh-update.sh" /usr/local/sbin/dsh-update
echo "已安装 /usr/local/sbin/dsh-update"

SUDOERS=/etc/sudoers.d/dsh-desktop-updater
cat > "${SUDOERS}" <<EOF
# DeepSeek Harness 桌面客户端：仅允许免密调用固定升级助手。
# 助手内部只接受形如 x.y.z[-priv.n] 的版本号，并通过系统 npm 安装 @deepseek-ai/dsh。
${TARGET_USER} ALL=(root) NOPASSWD: /usr/local/sbin/dsh-update
EOF
chown root:root "${SUDOERS}"
chmod 0440 "${SUDOERS}"
if ! visudo -cf "${SUDOERS}" >/dev/null; then
  echo "sudoers 校验失败，已回滚" >&2
  rm -f "${SUDOERS}"
  exit 1
fi
echo "已写入 ${SUDOERS}"

if [[ -n "${SANDBOX}" && -e "${SANDBOX}" ]]; then
  chown root:root "${SANDBOX}"
  chmod 4755 "${SANDBOX}"
  echo "已为 chrome-sandbox 设置 setuid: ${SANDBOX}"
fi

echo "OK: 特权配置完成"
