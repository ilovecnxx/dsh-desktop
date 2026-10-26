# DSH Desktop 1.4.10：外部服务模式下自动拉起用户服务

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 现象

打开桌面客户端后一直停在「正在连接外部 dsh 服务…」，约 90 秒后弹出
「外部服务不可用：配置为外部服务模式，但端口 3080 上没有可用的 dsh 服务」并退出，
表现为“进不去”。

## 根因

`~/.config/dsh-desktop/config.json` 为 `externalService: true, port: 3080`。
外部服务模式下 `ensureServer()` 只探测和等待，**不会自己拉起 `dsh web`**。
而 3080 对应的用户级服务 `dsh-web-session.service` 在 13:55 被停止
（当时只有 3081 的 root 服务在跑），于是：

1. `detectExisting()` 探测 3080 失败；
2. 进入 90 秒等待，`main.log` 记录 `外部服务暂不可用，等待服务就绪（最多 90 秒）`；
3. 超时后 `showErrorBox` + `quitApp()`。

## 修复

- `main/systemd-service.js`：新增 `parseUnitPort(text)` / `unitPort()`，
  从已安装 unit 的 `ExecStart` 解析 `--port`。
- `main/main.js`：新增 `tryStartUserService(port)`：
  - 仅当 unit 存在、端口与配置端口一致且服务未 active 时执行
    `systemctl --user start dsh-web-session.service`；
  - 启动失败只记日志，不阻断原有等待/报错流程；
  - 接入 `ensureServer()`（启动）、`restartServer()`（手动重启）、
    `recoverService()`（健康检查恢复）三处。
- 3081 的 root 服务由系统级 systemd 管理，unit 端口不匹配时直接跳过，
  不会触发需要 pkexec 授权的操作。

## 验证

- `npm test`：29/29 通过（新增 `parseUnitPort` 用例）。
- 现场验证：启动 `dsh-web-session.service` 后 3080 恢复监听，客户端
  `detectExisting()` 能识别 pid 与 token；客户端日志显示
  `加载界面: http://127.0.0.1:3080/?token=[redacted]`、`客户端启动完成`。
- 已执行 `npm run install:app` 安装到 `~/.local/opt/dsh-desktop`。
