# DSH Desktop 1.4.1：systemd 服务托管与桌面集成结论

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 后台服务与客户端解耦（systemd 用户服务）

- 新增 `main/systemd-service.js`：生成并安装
  `~/.config/systemd/user/dsh-web-session.service`：
  - `WorkingDirectory=<home>`、`DSH_HOME=<~/.dsh>`
  - `ExecStart=flock -n ~/.dsh/web.lock /usr/bin/dsh web --no-open --port 3080`
  - `Restart=on-failure`、日志 append 到 `~/.config/dsh-desktop/systemd-server.log`
- `ServerManager` 新增 systemd 模式：
  - 启动：`systemctl --user start` 后从服务日志解析带 token 的地址（多帧日志取最后一条）；
  - 复用：`detectExisting` 的 token 来源增加 systemd 日志，热切换后可继续复用；
  - 退出客户端：默认**不**停止 systemd 服务（`quitApp` 只停自己的子进程）；
  - `退出客户端并停止服务`/`退出应用` 时才会 `systemctl stop`；
  - systemd 不可用或启动失败：自动回退为客户端子进程托管，并记录日志。
- 诊断面板新增「启用 systemd 托管」「返回客户端托管」按钮，服务托管方式一行可见。
- 意义：以后客户端热切换/崩溃/手动重启，后台服务与会话都不再中断；只有切换托管方式
  或「退出应用」才会重启/停止服务。

### 迁移步骤（启用托管）

1. 诊断面板 →「启用 systemd 托管」→ 确认；
2. 会短暂重启一次后台服务（会话记录保留），之后客户端重启不再影响服务；
3. 托盘/菜单的「重启后台服务」会重启 systemd 服务，其余行为不变。

## 桌面集成结论（`docs/desktop-integration.md`）

- **文件管理器右键「用 DSH 打开」**：Nautilus 51 已移除脚本菜单，且本机未安装
  `nautilus-python`（本会话禁用审批无法 sudo 安装），暂不提供；`dsh://` 协议已可用，
  如需右键可后续安装 nautilus-python 后补扩展。
- **拖文件夹到窗口设为工作区**：Electron 沙箱 preload 无法取得拖入目录的绝对路径，
  且 `dsh web` 没有 workspace/工作区参数（工作区由服务进程 cwd 决定），暂不实现；
  可用「打开文件夹副本」方式后续做成独立服务实例（需要额外服务进程，成本较高）。
- **剪贴板图片粘贴**：dsh Web 前端已处理 `paste`/`clipboardData`（4 处），桌面端
  直接使用即可，无需额外代码。

## 验证

- `npm test`：24/24 通过（新增 systemd unit 生成、token 解析测试）。
- 迁移后 `systemctl --user is-active dsh-web-session.service` → `active`；
  关闭客户端再启动，服务 PID 不变、会话不中断（迁移脚本已验证）。
- CI 对 `v1.4.1` 构建 x64 `.deb`/AppImage 与 arm64 `.deb`。
