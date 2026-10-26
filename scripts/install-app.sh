#!/usr/bin/env bash
# 把桌面客户端安装到用户目录（无需 root）：
#   ~/.local/opt/dsh-desktop        Electron + 客户端代码
#   ~/.local/bin/dsh-desktop        启动器
#   ~/.local/share/applications     桌面图标入口
#   ~/.local/share/icons/hicolor    hicolor 图标
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="${DSH_DESKTOP_APP_ROOT:-$HOME/.local/opt/dsh-desktop}"
BIN_DIR="$HOME/.local/bin"
ICON_ROOT="$HOME/.local/share/icons/hicolor"
DESKTOP_DIR="$HOME/.local/share/applications"
ELECTRON_DIST="$SRC/node_modules/electron/dist"

if [[ ! -x "$ELECTRON_DIST/electron" ]]; then
  echo "Electron 运行时缺失，请先在项目目录运行: npm install && node node_modules/electron/install.js" >&2
  exit 1
fi
for f in icon-512.png icon-256.png icon-128.png icon-64.png icon-48.png icon-32.png; do
  if [[ ! -f "$SRC/assets/$f" ]]; then
    echo "缺少图标 assets/$f" >&2
    exit 1
  fi
done

echo "==> 准备客户端临时安装目录"
stage_root="${APP_ROOT}.staging.$$"
backup_root="${APP_ROOT}.rollback.$(date +%Y%m%d-%H%M%S)"
rm -rf "$stage_root"
mkdir -p "$stage_root/resources/app"
cleanup_stage() { rm -rf "$stage_root"; }
trap cleanup_stage EXIT

cp -a "$ELECTRON_DIST/." "$stage_root/"
mv "$stage_root/electron" "$stage_root/dsh-desktop"
chmod +x "$stage_root/dsh-desktop"

cp -a "$SRC/package.json" "$stage_root/resources/app/"
cp -a "$SRC/main" "$SRC/preload" "$SRC/assets" "$stage_root/resources/app/"
mkdir -p "$stage_root/resources/app/scripts"
cp -a "$SRC/scripts/." "$stage_root/resources/app/scripts/"

# 先校验新目录，再替换现有安装，避免半安装状态。
node --check "$stage_root/resources/app/main/main.js"
node --check "$stage_root/resources/app/main/server.js"
bash "$SRC/scripts/configure-sandbox.sh" "$stage_root" || true

echo "==> 原子替换安装目录"
if [[ -e "$APP_ROOT" || -L "$APP_ROOT" ]]; then
  mv "$APP_ROOT" "$backup_root"
fi
if ! mv "$stage_root" "$APP_ROOT"; then
  if [[ -e "$backup_root" ]]; then mv "$backup_root" "$APP_ROOT"; fi
  echo "安装替换失败，已恢复旧版本。" >&2
  exit 1
fi
trap - EXIT
rm -rf "$backup_root"

echo "==> 安装启动器 $BIN_DIR/dsh-desktop"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/dsh-desktop" <<EOF
#!/usr/bin/env bash
export DSH_DESKTOP_APP_ROOT="$APP_ROOT"
exec "$APP_ROOT/resources/app/scripts/launch-app.sh" "\$@"
EOF
chmod +x "$APP_ROOT/resources/app/scripts/launch-app.sh"
chmod +x "$BIN_DIR/dsh-desktop"
if [[ -f "$SRC/scripts/dsh-web" ]]; then
  cp "$SRC/scripts/dsh-web" "$BIN_DIR/dsh-web"
  chmod +x "$BIN_DIR/dsh-web"
fi

echo "==> 安装图标"
for pair in 512:512x512 256:256x256 128:128x128 64:64x64 48:48x48 32:32x32; do
  size="${pair%%:*}"
  dir="${pair##*:}"
  mkdir -p "$ICON_ROOT/$dir/apps"
  cp "$SRC/assets/icon-${size}.png" "$ICON_ROOT/$dir/apps/dsh-desktop.png"
done
cat > "$ICON_ROOT/index.theme" <<'THEME'
[Icon Theme]
Name=Hicolor
Comment=Fallback icon theme
Hidden=true
Directories=32x32/apps,48x48/apps,64x64/apps,128x128/apps,256x256/apps,512x512/apps

[32x32/apps]
Size=32
Context=Applications
Type=Threshold

[48x48/apps]
Size=48
Context=Applications
Type=Threshold

[64x64/apps]
Size=64
Context=Applications
Type=Threshold

[128x128/apps]
Size=128
Context=Applications
Type=Threshold

[256x256/apps]
Size=256
Context=Applications
Type=Threshold

[512x512/apps]
Size=512
Context=Applications
Type=Threshold
THEME
gtk-update-icon-cache -f -q "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

echo "==> 安装桌面入口"
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/dsh-desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=DeepSeek Harness
Name[zh_CN]=DeepSeek Harness
Comment=DeepSeek Harness desktop client
Comment[zh_CN]=DeepSeek Harness 桌面客户端（Linux）
Exec=$BIN_DIR/dsh-desktop
Icon=dsh-desktop
MimeType=x-scheme-handler/dsh;
Terminal=false
StartupNotify=true
StartupWMClass=dsh-desktop
Categories=Development;
Keywords=deepseek;harness;dsh;ai;agent;
EOF
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
xdg-mime default dsh-desktop.desktop x-scheme-handler/dsh >/dev/null 2>&1 || true

# 旧的浏览器版入口改名，避免两个同名图标
OLD="$DESKTOP_DIR/deepseek-harness.desktop"
if [[ -f "$OLD" ]]; then
  sed -i \
    -e 's/^Name=DeepSeek Harness$/Name=DeepSeek Harness (浏览器版)/' \
    -e 's/^Name\[zh_CN\]=DeepSeek Harness$/Name[zh_CN]=DeepSeek Harness (浏览器版)/' \
    "$OLD" || true
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

bash "$SRC/scripts/configure-sandbox.sh" "$APP_ROOT" || true
SANDBOX="$APP_ROOT/chrome-sandbox"
if [[ -e "$SANDBOX" ]]; then
  owner="$(stat -Lc %u "$SANDBOX")"
  mode="$(stat -Lc %a "$SANDBOX")"
  if [[ "$owner" -ne 0 || "$mode" != "4755" ]]; then
    echo
    echo "提示：还差最后一步（一次性，需要 sudo 密码）——启用 Chromium 沙箱并安装免密升级助手："
    echo "  sudo bash $SRC/scripts/setup-privileged.sh $SRC $USER '$SANDBOX'"
  fi
fi

echo
echo "==> 安装完成"
echo "启动命令：dsh-desktop    （或从应用菜单点击 DeepSeek Harness）"
