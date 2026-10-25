#!/usr/bin/env bash
# DeepSeek Harness 免密升级助手（由 root 拥有的脚本，客户端通过 sudo -n 调用）。
# 只接受合法的版本号，通过系统 npm 安装官方 @deepseek-ai/dsh 包。
set -euo pipefail

export PATH=/usr/local/bin:/usr/bin:/bin

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]; then
  echo "dsh-update: 非法的版本号: ${VERSION:-<空>}" >&2
  exit 2
fi

NPM=/usr/local/bin/npm
[[ -x "$NPM" ]] || NPM=/usr/bin/npm
if [[ ! -x "$NPM" ]]; then
  echo "dsh-update: 找不到 npm" >&2
  exit 3
fi

echo "dsh-update: 安装 @deepseek-ai/dsh@${VERSION}"
# --ignore-scripts：这些安装脚本以 root 身份运行有供应链风险；
# 当前平台所需原生模块（node-pty/koffi 等）已自带预编译产物，无需脚本。
exec "$NPM" install -g --ignore-scripts --no-fund --no-audit "@deepseek-ai/dsh@${VERSION}"
