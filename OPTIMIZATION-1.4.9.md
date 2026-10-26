# DSH Desktop 1.4.9：拖拽模糊弹层诊断与自动关闭

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 背景

拖入图片后仍出现「整个界面模糊、中间图片/文字」，判断可能是 dsh 前端自带的
全屏预览弹层（mask + backdrop blur）或 file:// 导航残留；此前无法直接截图确认。

## 本次改动

1. **拖拽后自动诊断**（preload）：
   - drop 后 600ms 扫描所有全屏元素，记录带 `backdrop-filter: blur` / `filter: blur`
     的遮罩的 tag、class、role、样式、位置、文本；
   - 通过 `dsh:drop-diagnostics` 发给主进程，写入 `main.log` 的 `[drop-diag]` 行；
   - 同时用 `webContents.capturePage()` 保存当前页面截图到
     `~/.config/dsh-desktop/drop-diag-latest.png`，便于直接查看真实画面。
2. **自动关闭**：若检测到模糊弹层且不是我们的遮罩，自动派发 Esc 关闭并提示
   「已自动关闭拖拽后残留的模糊弹层」。
3. **更严格阻止导航**：
   - `will-navigate` 阻止 `file://`（防止拖入图片把窗口导航成文件查看器）；
   - dragover/drop 对 `text/uri-list` 也视为文件拖拽并 `preventDefault()`。

## 验证

- `npm test`：28/28 通过。
- 真机操作后可在 `main.log` 搜索 `[drop-diag]`，并查看 `drop-diag-latest.png`；
  若模糊弹层仍出现，自动 Esc 应能关闭，并把弹层 DOM 信息记录下来供下一步修复。
