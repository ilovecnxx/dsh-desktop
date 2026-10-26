# DSH Desktop 1.4.2：拖拽/粘贴文件、长文本转文件、root 模式

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 拖拽与粘贴文件/图片

- 沙箱 preload 使用 Electron `webUtils.getPathForFile(file)` 读取拖入文件的真实路径
  （已实测沙箱 preload 可用）。
- 拖入文件/图片：插入每一行一个绝对路径到聊天输入框，并显示「已插入 N 个文件/图片路径」。
- 粘贴图片/文件：同样处理；若拿不到路径则把内容保存到
  `~/.config/dsh-desktop/pastes/` 后插入路径。
- 说明：dsh web 目前没有附件上传 API，因此采用「路径注入」方式；dsh 工具可直接读取
  这些文件。图片能否被模型看到取决于 dsh 的读图能力（模型侧），客户端不改变协议。

## 长文本粘贴转文件（CODEX 风格）

- 设置项：`pasteToFileEnabled`（默认开）、`pasteToFileThreshold`（默认 6000 字符）。
- 超过阈值时：保存为 `pastes/paste-<时间>.txt`，并向输入框插入该路径，附带 toast 提示。
- 设置窗口可开关与调整阈值；文本上限 4MB，超过则保持原生粘贴。

## root 运行模式（实验性）

- 设置项 `runServiceAsRoot`（默认关）：开启后 `ServerManager` 通过
  `sudo -n /usr/local/sbin/dsh-service` 以 root 启动 dsh web。
- 助手脚本：
  - `scripts/dsh-service`：以 root 运行 `dsh web`（HOME/DSH_HOME 指向原用户）；
  - `scripts/dsh-fix-owner`：把 `~/.dsh` 属主改回用户；
  - `scripts/setup-root.sh`：安装两个助手到 `/usr/local/sbin` 并写
    `/etc/sudoers.d/dsh-desktop-root`（需 `sudo bash scripts/setup-root.sh` 一次）。
- 安全/失败处理：助手缺失或 sudo 失败时自动回退普通权限并记录日志；
  诊断面板提供「修复 dsh 文件属主」。
- 注意：root 模式的会话文件属主为 root，切回普通模式前建议先修复属主；
  本机当前不免密 sudo，需用户手动执行 setup-root.sh 后该开关才生效。

## 验证

- 沙箱 preload `webUtils` 可用性已用独立 Electron 实例实测（object/function）。
- `npm test`：24/24 通过。
- 客户端热切换（systemd 托管）不影响后台服务与会话。
- CI 构建 x64 deb/AppImage 与 arm64 deb。
