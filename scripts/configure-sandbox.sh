#!/usr/bin/env bash
# 可选：复用系统 Chrome 已正确安装、API 兼容的 root setuid 沙箱。
# 不禁用沙箱，也不修改系统 helper 权限。
set -euo pipefail
target="${1:?需要 Electron 安装目录}/chrome-sandbox"
valid_helper() {
  [[ -f "$1" && -x "$1" && -u "$1" ]] || return 1
  [[ "$(stat -Lc %u "$1")" == 0 ]] || return 1
  local mode
  mode=$(stat -Lc %a "$1")
  (( (8#$mode & 0022) == 0 ))
}
if valid_helper "$target"; then exit 0; fi
helper=/opt/google/chrome/chrome-sandbox
if valid_helper "$helper" && [[ -x "$target" ]]; then
  required=$("$target" --get-api)
  available=$("$helper" --get-api)
  if [[ -n "$required" && "$required" == "$available" ]]; then
    if [[ ! -e "$target.unconfigured" ]]; then cp -p "$target" "$target.unconfigured"; fi
    ln -sfn "$helper" "$target"
    echo "复用系统 Chromium 沙箱（API $available）：$helper"
    exit 0
  fi
fi
echo '没有找到兼容的系统沙箱，请使用 setup-privileged.sh 完成沙箱权限配置。' >&2
exit 1
