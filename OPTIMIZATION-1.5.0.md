# DSH Desktop 1.5.0：官方功能对齐 + GitHub 状态

2026-10-26。

## 新增

- **GitHub 状态**（菜单「帮助 → GitHub 状态…」/ 诊断面板按钮）：
  - Stars、Forks、开放 issue；
  - 最新 Release 标签；
  - 最新 `Release Linux packages` 与 `E2E attachments` 工作流状态；
  - 可打开仓库 / Actions 页面、刷新。
- **管理 dsh 命令**：显示 dsh 路径、版本、当前服务模式，可复制
  `npm i -g @deepseek-ai/dsh` 安装命令、打开 npm 页面。
- **开发者工具**：F12 / Ctrl+Shift+I 切换 DevTools（主窗口与多窗口均生效），
  菜单「帮助 → 开发者工具」。
- **退出确认**：会话有任务运行中时，退出客户端会弹二次确认。
- **关于面板**补充：服务模式、Electron/Node、GitHub 地址。

## 官方功能对照

新增 `docs/OFFICIAL-PARITY.md`，逐项对照官方桌面端 README：

- ✅ 已对齐：Electron 壳、单实例、dsh://、关于、托盘/关闭、退出确认、
  DevTools、通知、诊断、GitHub 更新检查、附件、多窗口、工作区等；
- ⚠️ 暂未实现：可配置快捷键、多语言、自带运行时（记录原因与后续）；
- ❌ 不适用：Windows/macOS 原生顶栏、Platform 账号、签名更新。

## 验证

- `npm test`：30/30；
- GitHub 状态依赖 GitHub API（未认证有速率限制，失败会弹错误并写日志）。
