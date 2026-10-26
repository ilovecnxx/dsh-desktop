#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="${DSH_DESKTOP_APP_ROOT:-$HOME/.local/opt/dsh-desktop}"
runtime="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
config="${DSH_DESKTOP_USER_DATA:-$HOME/.config/dsh-desktop}/config.json"
if [[ -z "${XDG_RUNTIME_DIR:-}" && -d "$runtime" ]]; then export XDG_RUNTIME_DIR="$runtime"; fi
if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" && -S "$runtime/bus" ]]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus"
fi
if [[ -z "${WAYLAND_DISPLAY:-}" && -S "$runtime/wayland-0" ]]; then export WAYLAND_DISPLAY=wayland-0; fi
wayland_socket="${WAYLAND_DISPLAY:-}"
if [[ -n "$wayland_socket" && "$wayland_socket" != /* ]]; then wayland_socket="$runtime/$wayland_socket"; fi

# 不再根据 X0 文件存在就认定 X11 可用：必须通过当前会话认证。
x11_ok=0
if command -v xprop >/dev/null && command -v timeout >/dev/null; then
  display="${DISPLAY:-:0}"
  if DISPLAY="$display" timeout 1 xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1; then
    export DISPLAY="$display"; x11_ok=1
  else
    for auth in "$runtime"/.mutter-Xwaylandauth.*; do
      [[ -f "$auth" && -O "$auth" ]] || continue
      if DISPLAY="$display" XAUTHORITY="$auth" timeout 1 xprop -root _NET_SUPPORTING_WM_CHECK >/dev/null 2>&1; then
        export DISPLAY="$display" XAUTHORITY="$auth"; x11_ok=1; break
      fi
    done
  fi
fi
use_x11="${DSH_DESKTOP_X11:-}"
if [[ -z "$use_x11" ]]; then
  use_x11=$(/usr/bin/node -e 'try { process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).useX11 === true ? "1" : "0") } catch { process.stdout.write("0") }' "$config")
fi
platform=""
if [[ "$use_x11" == 1 && "$x11_ok" == 1 ]]; then
  platform=x11
elif [[ -n "$wayland_socket" && -S "$wayland_socket" ]]; then
  platform=wayland
  if [[ "$x11_ok" != 1 ]]; then unset DISPLAY; fi
elif [[ "$x11_ok" == 1 ]]; then
  platform=x11
else
  echo 'DeepSeek Harness：没有可连接的图形会话，请在桌面会话中启动。' >&2
  exit 1
fi
# GPU 反复崩溃时可用软件渲染启动（设置里开启，或 DSH_DESKTOP_SOFTWARE_RENDERING=1）
software="${DSH_DESKTOP_SOFTWARE_RENDERING:-}"
if [[ -z "$software" ]]; then
  software=$(/usr/bin/node -e 'try { process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).softwareRendering === true ? "1" : "0") } catch { process.stdout.write("0") }' "$config")
fi
extra=()
if [[ "$software" == 1 ]]; then extra+=(--disable-gpu --in-process-gpu --disable-gpu-process-crash-limit); fi
for arg in "$@"; do
  if [[ "$arg" == --ozone-platform* ]]; then exec "$APP_ROOT/dsh-desktop" "${extra[@]}" "$@"; fi
done
exec "$APP_ROOT/dsh-desktop" "--ozone-platform=$platform" "${extra[@]}" "$@"
