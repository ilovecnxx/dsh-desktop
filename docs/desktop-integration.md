# 桌面集成能力与结论

| 能力 | 状态 | 说明 |
|---|---|---|
| `dsh://` 协议 | ✅ 已实现 | `dsh://new` 新建窗口，其余聚焦主窗口；安装脚本注册 `x-scheme-handler/dsh` |
| 文件管理器右键「用 DSH 打开」 | ⚠️ 暂不可用 | Nautilus 51 无脚本菜单；`nautilus-python` 未安装（需 sudo/审批） |
| 拖文件夹到窗口设为工作区 | ⚠️ 暂不可用 | Electron 沙箱 preload 无法取目录绝对路径；dsh web 无 workspace 参数 |
| 剪贴板图片粘贴 | ✅ Web 已支持 | 前端处理 `paste`/`clipboardData`，桌面端无需改动 |
| 系统通知（任务完成/待确认） | ✅ 已实现 | 见 1.3.1 |
| 开机自启/静默启动 | ✅ 已实现 | `--autostart` 静默到托盘；窗口位置多显示器校验 |
| 多窗口/最近会话 | ✅ 已实现 | 见 1.4.0 |

## 后续可行方案

- 文件管理器右键：安装 `nautilus-python` 后提供扩展菜单（调用 `dsh-desktop --open-folder`）。
- 拖文件夹：需要客户端为每个文件夹启动独立的 `dsh web` 实例（cwd=文件夹）并发现 token，
  每个实例约 1 GB 内存；或等 dsh 提供 workspace API/URL 路由后再接入。
