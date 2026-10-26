# DSH Desktop 1.3.2：更新体验与数据管理

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 更新体验

- 设置窗口新增「自动检查间隔」（6/12/24 小时，写入 `checkIntervalMs`）。
- 设置窗口新增「npm 镜像源」（`registry`）：默认官方源，国内可填
  `https://registry.npmmirror.com/`；保存后立即清空版本缓存并按新源检查。
- 帮助菜单新增「查看 dsh 更新说明」，打开官方 releases 页面。

## 数据管理

- 诊断面板新增「导出诊断包」：通过保存对话框输出
  `dsh-desktop-diagnostics-<时间>.tar.gz`，包含 `diagnostics.json`、
  `config.json`、`main.log`、`server.log`、`rollout.log`。
- 诊断面板新增「清理缓存」：清空 Chromium 缓存目录（Cache、Code Cache、
  GPUCache 等），重启客户端后完全生效；不会删除登录态/会话数据。

## 多显示器

- 启动时校验上次保存的窗口位置是否落在任一显示器工作区内；布局变化或显示器
  被移除时回退到默认尺寸/位置，避免窗口出现在屏幕外。

## 验证

- `npm test`：16/16 通过（新增 `normalizeRegistry`）。
- 设置/诊断窗口 UI 由同一套 IPC 数据驱动，新增字段与按钮沿用既有校验。
- 安装 1.3.2 后热切换生效，服务未中断。
