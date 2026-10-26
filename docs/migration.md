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
