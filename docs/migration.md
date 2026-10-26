# 迁移步骤：开发端（3080）→ 桌面端

当前双轨状态：

| 角色 | 服务 | 存储 | 客户端 |
|---|---|---|---|
| 开发端 | 3080（用户级 systemd `dsh-web-session.service`） | `~/.dsh` | 浏览器/Chrome |
| root 测试端 | 3081（系统级 `dsh-web-root.service`） | `~/.dsh-root` | 桌面客户端（externalService） |

桌面端稳定后的迁移清单：

1. **确认稳定性**：连续 1–2 天桌面客户端无崩溃；外部服务断线可自动重连
   （1.4.5+）；工作区/多窗口/最近会话/拖拽粘贴均可用。
2. **统一服务归属**（二选一）：
   - 保留用户级服务：把桌面端配置指向 3080（诊断面板「连接开发服务(3080)」），
     即桌面端与浏览器共用开发服务；
   - 切到 systemd 用户服务：`systemctl --user enable --now dsh-web-session.service`，
     客户端配置 `externalService=true, port=3080`，客户端重启不再中断服务。
3. **root 需求**：仅在需要系统级操作时切到 3081（诊断面板「连接 root 测试(3081)」）；
   root 会话在 `~/.dsh-root`，与开发会话隔离；文件属主要为用户时执行
   `sudo /usr/local/sbin/dsh-fix-owner`（会处理 `~/.dsh`）。
4. **停止浏览器入口**：确认桌面端正常后，关闭 Chrome 开发页；需要时保留书签。
5. **回滚**：桌面端出问题时，浏览器仍可打开 3080 的 token URL 继续工作；
   root 测试不影响开发端。
6. **卸载/清理**：`~/.local/opt/dsh-desktop`、`~/.config/dsh-desktop`、
   `/usr/local/sbin/dsh-service`、`/etc/systemd/system/dsh-web-root.service`、
   sudoers 文件按需移除。

## 稳定性观察（1–2 天）

观察已从 2026-10-26 开始。每天检查：

```bash
# 客户端是否在运行、web 服务是否健康
pgrep -af "opt/dsh-desktop/dsh-desktop --ozone" | head -1
ss -ltn | grep -E ':3080 |:3081 '
systemctl --user is-active dsh-web-session.service
systemctl is-active dsh-web-root.service

# 稳定性指标（客户端每 60s 刷新一次）
cat ~/.config/dsh-desktop/stability.json
```

观察清单：

- [ ] `stability.json` 中 `reconnects`、`gpuFallbacks`、`serviceRestarts` 保持 0 或极少；
- [ ] 客户端连续运行期间无崩溃/白屏；
- [ ] 拖拽图片/文件夹、多窗口、最近会话、长文本转文件均正常；
- [ ] 服务端重启（systemctl restart）后客户端能自动重连；
- [ ] 2 天后无异常 → 结束观察，按上文「迁移步骤」正式切换；
- [ ] 出现异常 → 保留 `main.log`、`stability.json`，用浏览器打开 3080 继续工作并回滚。

## 迁移完成记录

- 正式切换时间：**2026-10-26 14:52（CST）**
- 桌面客户端版本：1.4.18；作为主入口（`desktopPrimary: true`）
- 后台服务：3080，systemd 用户服务 `dsh-web-session.service`（enabled + active）
- 客户端重启不影响服务：已验证（重启前后服务 MainPID 不变）
- 浏览器：已不再使用（无 Chrome 进程）
- root 测试端：3081 `dsh-web-root.service` 保留，仅测试用途
- 观察窗口：截至切换仅 3 条快照（约 25 分钟，提前切换）；切换后继续每日快照
- 迁移记录文件：`~/.config/dsh-desktop/migration.json`
- 回滚：浏览器打开 3080 token URL；或
  `systemctl --user restart dsh-web-session.service` 后重启客户端
