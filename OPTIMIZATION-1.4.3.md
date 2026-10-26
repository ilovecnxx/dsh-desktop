# DSH Desktop 1.4.3：外部服务模式与 root 系统服务

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 外部服务模式

- 新增配置 `externalService`（默认 false）与 `port`：
  - `externalService=true` 时客户端**不探测端口、不自动换端口、不拉起子进程**，
    只连接 `127.0.0.1:<port>` 上已有的 dsh 服务；
  - token 从客户端日志、systemd 日志与 `~/.dsh/web.log` 中按端口匹配并校验；
  - 若服务进程属于 root，普通用户读不到 pid 时，token 校验通过即允许复用
    （日志记录「复用外部服务（token 已校验，进程属主不可见）」）；
  - 没有可用服务时弹出明确错误提示（不再静默改端口导致一连串失败）。

## root 系统服务（测试环境）

- 独立系统级单元 `dsh-web-root.service`：
  - 以 root 运行 `dsh web --no-open --port 3081`；
  - `Restart=on-failure`、开机自启（multi-user.target）；
  - 日志 append 到 `~/.config/dsh-desktop/systemd-server.log`；
  - 锁文件 `~/.dsh/web-root.lock`，与用户服务的 `web.lock` 隔离。
- 桌面客户端配置：`port=3081`、`externalService=true`，只连接该 root 服务用于测试。
- 开发环境（3080 用户服务 + 浏览器）保持不变，二者互不影响。

### 启用步骤（需 root）

```bash
sudo systemctl enable --now dsh-web-root.service
# 客户端配置 ~/.config/dsh-desktop/config.json:
#   "port": 3081, "externalService": true
```

root 运行会把新会话文件写成 root 所有；迁移回普通模式前，可执行
`sudo /usr/local/sbin/dsh-fix-owner` 或诊断面板「修复 dsh 文件属主」。

## 验证

- `npm test`：25/25 通过（含 root systemd 单元生成测试）。
- 本机布局：3080 = 开发（用户权限，Chrome 使用）；3081 = root 服务（桌面端测试）。
- 桌面端日志确认：`加载界面: http://127.0.0.1:3081/`、`客户端启动完成`。
