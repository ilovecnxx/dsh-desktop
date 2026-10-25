# DSH Desktop（Linux 桌面客户端）

[![CI](https://github.com/ilovecnxx/dsh-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/ilovecnxx/dsh-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/platform-Linux%20%7C%20Ubuntu-informational)](https://github.com/ilovecnxx/dsh-desktop)

为 **DeepSeek Harness** 在 Linux（Ubuntu/GNOME，Wayland 或 X11）上提供接近官方
Windows / macOS 客户端的体验：原生窗口、系统托盘、应用菜单，以及**点击一键自动升级**。

> 官方 `@deepseek-ai/dsh-desktop`（Electron）目前只打包 mac（arm64/x64）和 win（x64），
> 没有 Linux 产物。本项目是自建的轻量 Linux 客户端，复用官方 `dsh web` 服务与 Web UI，
> 不使用任何第三方二进制。

## 功能

- 原生 Electron 窗口加载现有 Web UI（同一 `~/.dsh` 会话、profile、插件）
- 系统托盘：打开窗口、检查更新、重启服务、开机自启、退出
- 应用菜单：检查更新（`Ctrl+U`）、更新通道（`next` / `latest`）、服务管理、开发者工具
- 启动后自动检查更新，之后每 6 小时一次；发现新版本时：
  - 页面右下角出现「发现新版本 vX · 立即升级」提示条
  - 系统通知提醒
- 点击升级后自动完成：停止服务 → 安装新版本 → 同步 profile 插件 → 重启服务 → 刷新界面
- 更新使用一次性配置的**免密升级助手**，之后升级不再询问密码
- **服务健康监控**：每 15 秒探测服务；崩溃或无响应时自动重启，并显示「正在恢复服务…」页面
- **客户端壳自更新**：菜单「检查客户端更新…」，从更新源原子替换客户端文件后重启（自动备份可回滚）
- 服务自动重启可在托盘/应用菜单里开关
- **设置中心**（`Ctrl+,`）：更新通道、自动更新、自动重启、托盘、开机自启、全局快捷键、健康检查间隔
- **诊断面板**：版本/服务状态/最近日志，一键复制诊断信息或重启服务
- **全局快捷键** `Ctrl+Alt+Space`：显示/隐藏窗口（可关闭）。Wayland 下默认以 XWayland 运行以支持全局快捷键，可在设置里退回原生 Wayland
- 托盘显示服务状态；窗口位置/大小自动记忆
- 端口自动回退：3080 被非 dsh 程序占用时自动尝试后续端口
- 关闭窗口默认收进托盘；`~/.config/dsh-desktop/config.json` 可调整行为

## 界面预览

| 主界面 | 发现新版本 |
|---|---|
| ![主界面](docs/screenshot-main.png) | ![发现新版本](docs/screenshot-update-banner.png) |

## 首次启动

从应用菜单点击 **DeepSeek Harness**（或运行 `dsh-desktop`）。如果之前用浏览器版
`dsh-start` 启动的服务仍在运行，客户端会询问：

- **接管并重启服务**：停止旧服务，由客户端托管（旧浏览器窗口会断开，会话记录保留）
- **仅打开现有服务**：直接复用旧服务，暂不接管（之后可在托盘菜单「重启服务」切换）
- **取消**：退出

接管后，窗口关闭默认收进系统托盘，后台服务继续运行；从托盘菜单可退出。


## 目录结构

```
dsh-desktop/
├── main/
│   ├── main.js       # 应用入口：窗口、托盘、菜单、IPC、更新编排
│   ├── server.js     # dsh web 服务生命周期（启动/停止/接管/重启）
│   ├── updater.js    # npm 版本检查、免密升级、profile 插件同步
│   ├── shell-updater.js # 客户端壳自更新（检查更新源、原子替换、回滚）
│   ├── utility.js    # 设置中心 + 诊断面板窗口
│   ├── config.js     # 配置持久化
│   └── menu.js       # 应用菜单 + 托盘菜单
├── preload/
│   ├── preload.js    # 页面内更新提示条（Shadow DOM 注入）
│   └── utility.js    # 设置/诊断窗口的白名单 IPC
├── assets/           # 图标（由官方 SVG 生成）
└── scripts/
    ├── install-app.sh       # 安装到用户目录（无需 root）
    ├── setup-privileged.sh  # 一次性特权配置（sudo：升级助手 + 沙箱）
    ├── dsh-update.sh        # root 升级助手（安装到 /usr/local/sbin）
    └── uninstall-app.sh     # 卸载客户端
```

## 安装

环境要求：Node.js ≥ 20（开发测试使用 Node 24）、npm、Ubuntu/GNOME（Wayland 或 X11）。
首次启动前需要本机已经有可用的 `@deepseek-ai/dsh`，即 `dsh --version` 能正常输出。

```bash
git clone https://github.com/ilovecnxx/dsh-desktop.git
cd dsh-desktop
npm install                    # 安装 Electron
node node_modules/electron/install.js   # 下载 Electron 二进制（123MB）

bash scripts/install-app.sh    # 用户目录安装 + 桌面图标

# 一次性特权配置（弹一次 sudo 密码）
sudo bash scripts/setup-privileged.sh \
  "$PWD/scripts" "$USER" "$HOME/.local/opt/dsh-desktop/chrome-sandbox"
```

完成后从应用菜单点击 **DeepSeek Harness** 启动，或终端运行 `dsh-desktop`。

## 升级逻辑

1. 客户端启动 8 秒后、之后每 6 小时：请求 npm registry 的 `dist-tags`
   （通道 `next` → `dist-tags.next`；通道 `latest` → `dist-tags.latest`）
2. 与本地 `dsh --version` 比较；有新版本时在页面内显示升级提示条
3. 点击升级：
   - 停止客户端管理的 `dsh web` 进程
   - `sudo -n /usr/local/sbin/dsh-update <version>`（免密，助手内校验版本号格式）
   - 若 `@deepseek-ai/dsh-subagent-codex@<version>` 已发布，则同步 profile 插件版本
     （其 peerDependencies 要求与 dsh 精确一致）
   - 用新版本重启服务，重新加载窗口
4. 失败时尽量恢复原有服务并提示错误

## 服务健康监控

- 客户端每 15 秒（`healthIntervalMs`）探测一次当前服务
- 服务进程意外退出，或连续两次探测无响应时：
  - 自动停止旧进程并重新拉起服务
  - 期间窗口显示「正在恢复 DeepSeek Harness 服务…」页面，恢复后自动刷新回原界面
  - 系统通知提示恢复结果
- 可在托盘/应用菜单「服务 → 服务异常时自动重启」关闭
- 恢复失败会停留在恢复页并提示错误，不会白屏

## 客户端自更新

客户端壳（Electron 应用本身）与 dsh 运行时分开更新：

- 菜单「DeepSeek Harness → 检查客户端更新…」，也可由 `shellAutoCheck` 自动检查
- 更新源默认为开发目录，可用环境变量 `DSH_DESKTOP_SHELL_SOURCE` 指向任意包含
  `main/`、`preload/`、`assets/`、`package.json` 的目录，例如更新后的 `git clone`
  目录（从 GitHub 安装的用户建议显式设置该变量，指向自己维护的客户端副本）
- 更新流程：停止服务 → 复制更新源到 `resources/app.staging` 并校验 → 备份旧版为
  `resources/app.backup` → 原子换入 → 重启客户端
- 只复制白名单条目，不执行更新源中的任何脚本；失败自动恢复旧版与服务
- 客户端版本记录在 `resources/app/package.json`，「关于」窗口可见

## 安全说明

- 客户端进程始终以普通用户运行；提权只发生在一个 root 拥有的固定脚本
  `/usr/local/sbin/dsh-update` 上，sudoers 规则只允许该脚本免密执行。
- 助手脚本只接受 `x.y.z` / `x.y.z-{alpha,beta,rc}.n` 形式的版本号，且只安装
  `@deepseek-ai/dsh`；安装时使用 `--ignore-scripts` 避免以 root 执行依赖安装脚本。
- 代价：任何本地用户进程都能调用该助手升级 dsh（这正是「免密一键升级」权限）。
  单用户桌面可接受；多用户共享机器不建议启用。
- Electron 使用 `chrome-sandbox` setuid 沙箱运行渲染进程。

## 回滚 / 卸载

客户端自更新会保留一份旧版备份，可手动回滚：

```bash
APP=~/.local/opt/dsh-desktop/resources
mv "$APP/app" "$APP/app.failed" && mv "$APP/app.backup" "$APP/app"
```

卸载：

```bash
bash scripts/uninstall-app.sh
sudo rm -f /usr/local/sbin/dsh-update /etc/sudoers.d/dsh-desktop-updater
```

旧版浏览器入口（桌面图标与 `dsh-start`/`dsh-stop`/`dsh-client` 脚本）已在切换到桌面客户端时删除；
如需浏览器模式，可手动运行 `dsh web` 后访问 http://127.0.0.1:3080 。

## 已知限制

- 更新时服务会重启，正在进行的对话会中断（会话记录保留，可重新打开）。
- 客户端自更新会重启整个客户端应用（同样会重启服务），会话记录保留。
- 不存在新版本时，手动检查会提示「已是最新版本」。
- Linux 托盘依赖桌面环境的状态栏支持（GNOME 需 AppIndicator 扩展，Ubuntu 默认已启用）。
- Wayland 会话下默认以 XWayland（`--ozone-platform=x11`）运行：这是全局快捷键可用的前提；
  在设置里关闭「Wayland 兼容模式」会改用原生 Wayland，此时全局快捷键不可用。
- 全局快捷键 `Ctrl+Alt+Space` 若与其他应用冲突，可在设置里关闭。

## 1.2.1 启动与恢复优化

详见 [优化记录及实测](OPTIMIZATION-1.2.1.md)。默认验证并复用已有 Web 服务，新增启动反馈、失败快速退出、恢复防重入、原子配置保存及有界日志读取。测试命令：`npm test`。

## 开发与测试

```bash
npm test        # node --test，覆盖服务生命周期、配置原子写入、诊断日志脱敏等
```

## 许可证

[MIT](LICENSE) © 2026 ilovecnxx

本项目是社区自建的 Linux 客户端，与 DeepSeek 官方无隶属关系；`DeepSeek Harness`
及相关名称、图标归其各自权利人所有。

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
