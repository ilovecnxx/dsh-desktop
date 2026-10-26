# DSH Desktop 1.4.16：运行中状态条残留取证

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 现象

dsh 聊天页顶部/底部的「任务运行中」状态条，在任务/对话结束后没有自动消失。

## 原因分析

该状态条由 dsh 前端（`dsh-client-ui-chat`）根据会话 `running` 状态渲染，
正常应在 turn 结束事件后移除。客户端 preload 不注入该条、也不拦截相关事件；
残留更可能是 turn 结束事件丢失/延迟或前端状态未清理，需要 DOM 级证据定位。

## 本次改动

- 会话 watcher 检测到 `running: true → false` 后 5 秒，自动执行：
  - 扫描文本匹配「运行中/任务运行/Working/Running」或 class 含 `_running` 的元素；
  - 记录 tag/class/text/位置/display/visibility/outerHTML（截断）；
  - 保存 `~/.config/dsh-desktop/ui-report-idle-<时间>.json` + 同名 `.png` 截图。
- 诊断面板新增「导出界面状态」，可手动触发同样采集。
- 仍发送「会话已完成」系统通知，不改变 UI 行为。

## 下一步

- 若状态条再次残留，把 `ui-report-idle-*.json/png` 给我：可判断是
  dsh 前端未清理还是客户端相关；
- 确认后可做兼容隐藏（仅对该状态条）或整理证据提交 dsh 上游；
- 临时刷新（Ctrl+R）可立即移除残留条。

## 验证

- `npm test`：30/30 通过。
