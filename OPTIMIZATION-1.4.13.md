# DSH Desktop 1.4.13：工作区内存优化、附件 e2e、稳定性观察

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 工作区实例内存优化

- `config.workspaceLimit`（默认 3）：同时保留的工作区实例上限；
- 打开新工作区时若已达上限，自动关闭最旧的工作区窗口并停止其服务；
- 诊断面板新增「关闭全部工作区」；设置窗口可调整上限（1–10）。

## 图片附件自动化 e2e

- `scripts/e2e-attachments.js`：临时 DSH_HOME + 隔离 `dsh web`（端口 0）+ Electron
  测试实例，实际执行：
  1. 三张图片的拖拽（DragEvent + DataTransfer）；
  2. 写系统剪贴板图片 + `Ctrl+V` 粘贴；
  3. 统计附件 chips、全屏模糊遮罩数量。
- 本地实测结果：
  `{"drop":{"chips":3,"fullscreenBlur":0},"paste":{"chips":6}}`
  即多图批量与截图粘贴均生效，且不再出现模糊遮罩。
- CI：新增 `.github/workflows/e2e.yml`（xvfb + 全局安装 dsh + 无头 Electron）。
  注：发送后消息预览依赖 dsh 前端与模型配置，未在 e2e 中触发真实模型调用。

## 稳定性指标与观察

- 客户端每 60 秒写入 `~/.config/dsh-desktop/stability.json`：
  version、dshVersion、startedAt、uptimeMs、reconnects、gpuFallbacks、
  serviceRestarts、port、externalService、workspaceCount、softwareRendering；
- 诊断面板新增：运行时长、自动重连次数、GPU 降级次数、工作区窗口数；
- 新增「导出稳定性报告」按钮；
- 用户级服务已 `systemctl --user enable`，桌面客户端已配置开机自启；
- `docs/migration.md` 补充 1–2 天稳定性观察清单与回滚方式。

## 验证

- `npm test`：30/30 通过。
- `node scripts/e2e-attachments.js`（本地，显示环境）：通过。
- 客户端热切换 1.4.13，3080 开发 + 3081 root 测试均不重启。
