# Flatpak 可行性说明

当前状态：**未启用 Flatpak 打包**，提供结论与后续方案。

## 结论

- electron-builder 不支持 `flatpak` target；需要手写 Flatpak manifest 并依赖
  `flatpak-builder`、`org.freedesktop.Platform`/`Sdk` 运行时（约 1–2 GB），
  当前开发机与 CI 均未安装。
- DSH Desktop 已提供 `.deb` 与 AppImage，覆盖 Debian/Ubuntu 与免安装场景；
  Flatpak 主要收益是沙箱隔离与 Flathub 分发，但对本客户端收益有限：
  - 客户端需要访问 `~/.dsh` 会话、`~/.local/opt/dsh-desktop` 运行时与 npm 全局包，
    Flatpak 沙箱需要额外 `--filesystem=home` 等权限；
  - 免密更新助手 `/usr/local/sbin/dsh-update` 依赖宿主机 root 权限，沙箱内无法直接使用，
    需要改为宿主机助手（如 `flatpak-spawn` + 用户级安装）。
- 因此 Flatpak 属于「可行但需要额外工程与权限模型调整」，优先级低于 deb/AppImage。

## 后续方案（若需要）

1. 使用 `org.freedesktop.Sdk` + `org.electronjs.Electron2.BaseApp`；
2. manifest 中以 `extra-data` 或 `install` 方式放入 `dist/linux-unpacked`；
3. 权限：`--filesystem=~/.dsh:rw`、`--filesystem=~/.local/opt:rw`，
   通过 Flatpak portal 打开外部链接；
4. 更新改为用户级运行时（见路线图「自带运行时」），避免宿主机 root 助手；
5. 在 Flathub 提交前补充 metainfo/appstream 与截图。

当前建议：继续使用 `.deb` / AppImage。
