# DSH Desktop 1.4.0：多窗口、最近会话、桌面集成

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 新功能

1. **多窗口/多会话**
   - 应用菜单/托盘「新建窗口」（`Ctrl+Shift+N`）加载同一 dsh web 服务的新窗口；
   - 页面中同源链接（如会话链接）会在新窗口打开，外部链接仍交给系统浏览器；
   - 每个窗口独立应用动效省电（失焦/空闲暂停循环动画）。
2. **最近会话**
   - 读取 `~/.dsh/sessions`（zstd 多帧解压）中最近 8 个会话标题；
   - 应用/托盘菜单「最近会话」点击后聚焦窗口，并在页面中按标题定位点击会话项
     （dsh Web UI 无 URL 路由，属 best-effort；失败只聚焦窗口）。
3. **附件与下载**
   - 文件拖入窗口时显示「松开上传」提示层，并阻止 Electron 打开文件/页面跳转；
   - 下载统一保存到系统下载目录，完成后发系统通知；菜单新增「打开下载目录」。
4. **更新与回滚**
   - dsh 更新对话框新增「查看更新说明」（官方 releases）；
   - 诊断面板新增「回滚客户端版本」（使用壳更新的 `app.backup`）和
     「回滚 dsh 运行时」（使用升级前记录的 `lastDshVersion`）。
5. **数据管理**
   - 「备份会话」：将会话目录打包为 tar.gz；
   - 「导出最近会话 Markdown」：只导出用户/助手文本，跳过推理与工具明细。
6. **桌面集成**
   - 注册 `dsh://` 协议：`dsh://new` 新建窗口，其余聚焦主窗口；
   - 安装脚本写入 `MimeType=x-scheme-handler/dsh` 并设置默认处理程序。
7. **分发**
   - 新增 arm64 `.deb` 交叉构建（本地验证 + CI job）；
   - Release CI 拆分 x64（deb+AppImage）与 arm64（deb）；
   - Flatpak 结论与方案见 `docs/flatpak.md`（暂不启用，原因已说明）。

## 验证

- `npm test`：21/21 通过（新增会话 Markdown、dsh:// 解析等测试）。
- 多窗口在隔离实例实测：创建第 2 个窗口，真实客户端不受影响。
- 最近会话标题读取实测（zstd 多帧）得到真实会话标题。
- 本地构建产物：`dist/dsh-desktop_1.4.0_amd64.deb`、`DeepSeek Harness-1.4.0.AppImage`、
  `dist/dsh-desktop_1.4.0_arm64.deb`。
- 安装 1.4.0 后热切换生效，服务未中断；`xdg-mime query default x-scheme-handler/dsh`
  应返回 `dsh-desktop.desktop`。
