# DSH Desktop 1.5.3：BUG 修复与磁盘/日志优化

2026-10-26。无新功能。

## 修复

1. **日志无限增长**：`rollout.log` 已 56MB（启动器 stdout 重定向，从未轮转）。
   现在客户端启动时按 2MB 轮转到 `.1`。
2. **缓存无清理**：
   - `ui-report-*` 只保留最近 20 个（json + png）；
   - `pastes/` 清理 7 天前或超过 200 个的文件。
3. **关闭提示重复**：改为配置 `closeHintShown` 持久化，只提示一次。
4. **owner-sync 只在 root 模式运行**：
   - `dsh-root-service` 助手新增 owner-start/stop/is-active；
   - 切 root 时启动 owner-sync；切回 3080 时先停 owner-sync、执行
     `dsh-fix-owner` 再启动开发服务；减少常驻 chown CPU。
5. **外部模式启动 3081 干等 90 秒**：启动时先用免密助手尝试拉起
   `dsh-web-root.service`，失败再等待/报错。
6. 修正 `openFolderWorkspace` 中 `updateTrayTooltip` 的错误缩进位置。

## 磁盘

- 清理 `dist/`（877MB）与 `rollout.log`（56MB），`/` 可用空间从 12G 回到 13G。

## 验证

- `npm test`：30/30；
- 启动日志确认轮转/清理逻辑无异常；
- 客户端重启到 1.5.3，root 模式 3081 正常。
