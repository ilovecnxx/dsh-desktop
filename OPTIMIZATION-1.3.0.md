# DSH Desktop 1.3.0：自动节能与 Linux 打包

2026-10-26。只改桌面端与构建，官方 `dsh` 核心未修改。

## 性能：动效模式新增「自动」

- `motionMode` 新增 `auto`（默认）：窗口失焦 **或** 聚焦但空闲超过 90 秒时，
  暂停所有无限循环动画（state-dot、row-shimmer 等）；有任何键鼠输入立即恢复。
- 只暂停 `iterations === Infinity` 的动画（Web Animations API），不冻结入场动画，
  不会造成侧边栏文字停在上透明状态。
- 配置项：`motionMode`（`auto`/`blur`/`normal`/`always`）、`motionIdleMs`（默认 90000）。
- 依据 1.2.6 实测：暂停循环动画后运行中会话 CPU 66% → 8.2%（GPU 25.4%→4.2%，
  渲染 35.9%→3.1%）；空闲无会话基线 0.2–0.4%。

## 分发：Linux 安装包

- 引入 `electron-builder`，新增 `npm run dist:linux`（`.deb` + AppImage）。
- 配置：`appId=dsh-desktop`、`productName=DeepSeek Harness`、输出 `dist/`、
  图标使用 `assets/icon-512.png`；打包内容为主进程/预加载/资源/脚本。
- 新增 `.github/workflows/release.yml`：推送 `v*` tag 时自动跑测试、构建
  `.deb`/AppImage 并附加到 GitHub Release。
- 文档：`docs/PACKAGING.md`。

## 使用安装包

```bash
# Debian/Ubuntu
sudo dpkg -i dist/dsh-desktop_1.3.0_amd64.deb
# AppImage（免安装）
chmod +x dist/DeepSeek-Harness-1.3.0.AppImage
./dist/DeepSeek-Harness-1.3.0.AppImage
```

说明：系统包安装版与用户目录版共用 `~/.dsh` 会话数据；打包版不依赖
`~/.local/bin/dsh-desktop` 启动器，自更新/开机自启仍以用户目录版为主。

## 验证

- `npm test`：14/14 通过。
- 本地构建产物位于 `dist/`（`.deb` 与 AppImage）。
- CI 工作流在 tag 推送时自动构建并发布。

## 回滚

`git checkout v1.2.6`；或删除 `dist/` 与 `.github/workflows/release.yml`。
