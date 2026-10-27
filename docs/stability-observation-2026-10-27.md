# 稳定性观察快照（2026-10-27 结束）

```json
{
  "version": "1.5.6",
  "dshVersion": "0.2.1-rc.4",
  "startedAt": "2026-10-26T17:38:55.699Z",
  "uptimeMs": 45361988,
  "reconnects": 0,
  "gpuFallbacks": 0,
  "serviceRestarts": 0,
  "port": 3080,
  "externalService": true,
  "workspaceCount": 0,
  "softwareRendering": true
}
```

- 客户端进程：user 身份，连续运行约 12h37m
- `dsh-web-session.service`：active；`dsh-web-root.service`：inactive（按需）
- 近 24h systemd 日志：无 error/failed/EACCES
- 工作区：default-workspace 22 个会话、linux-android 10 个会话
- 磁盘：`/` 95%（用户数据为主：Chrome 模型、Android SDK、linux-android 构建产物）

结论：指标正常，观察结束，详见 [migration.md](migration.md)。
