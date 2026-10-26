# DSH Desktop 1.3.1：系统通知

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 功能

- **会话完成通知**：窗口未聚焦时，会话从"运行中"变为空闲，弹系统通知
  「会话已完成 · <会话标题>」。
- **等待确认通知**：窗口未聚焦时页面出现确认弹窗（dialog），提醒
  「可能需要你的确认」。
- **点击通知**：聚焦并显示客户端窗口。
- 设置窗口可分别关闭这两类通知（`notifyOnFinish` / `notifyOnApproval`，默认开启）。

## 检测方式（不修改 dsh）

- 每 5 秒在主进程执行一段只读 JS：
  - 运行态：匹配 `[class*="spinner"],[class*="sweep"],[class*="highlight"],
    [class*="shimmer"],[class*="state-dot"]` 且 `animation-iteration-count: infinite`
    的元素存在即视为会话运行中；
  - 确认弹窗：`[role="dialog"],dialog` 数量。
- 仅当窗口**未聚焦**且状态发生跳变时通知，避免打扰；同一状态不重复提醒。
- 检测依赖 dsh Web 前端当前的类名/动画特征（hashed 前缀保持稳定）；
  若未来前端改版，需要同步调整选择器（集中在 `SESSION_STATE_JS`）。

## 验证

- `npm test`：15/15 通过（新增通知决策状态机测试）。
- 实际页面 DOM 特征来自运行中会话的抓取：`_spinnerMotion_*`、`_sweep_*`、
  `_highlight_*` 等无限动画元素。
- 安装 1.3.1 后热切换生效，服务未中断。

## 说明

- 通知只在窗口未聚焦时出现；聚焦时不会打扰。
- 若机器已因 GPU 问题自动切到软件渲染（`softwareRendering=true`），
  该功能不受影响。
