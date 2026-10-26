# DSH Desktop 1.4.17：状态条兼容、工作区回收、稳定性汇总

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 运行中状态条残留

- 会话 watcher 在 `running` 状态变化时通过 IPC 通知页面；
- 页面转空闲 8 秒后，若仍存在 dsh 的 `[class*="_running"]` 状态条，客户端注入
  `display:none!important` 隐藏；会话重新运行立即移除；
- 设置项 `autoHideStaleRunning`（默认开），可关闭；
- 保留 1.4.16 的 `ui-report-idle-*.json/png` 自动取证。

## 工作区闲置回收

- 每个工作区窗口记录 `lastUsedAt`（focus / 输入事件更新）；
- 每 60 秒检查：窗口失焦且闲置超过 `workspaceIdleMs`（默认 10 分钟）→ 关闭窗口，
  由 closed 处理器停止对应 dsh web 服务、释放内存；
- 设置项「工作区闲置回收（分钟）」1–240。

## 稳定性汇总

- 诊断面板「稳定性汇总」读取 `observation.jsonl`，输出：
  snapshots、first/last、clientRestarts、maxReconnects、maxGpuFallbacks、
  maxServiceRestarts、devServiceInactiveSnapshots、lastVersion，
  保存到 `observation-summary.json`。

## 验证

- `npm test`：30/30 通过。
- 客户端热切换 1.4.17；双轨 3080/3081 不重启。
