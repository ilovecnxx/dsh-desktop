# DSH Desktop 1.4.18：任务面板收尾、迁移向导、更新检查、性能基线

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 任务面板自动收起

- 会话转空闲 8 秒后，若存在文本明确显示「全部完成/0 个待办」且
  class/role 含 task/todo/progress/plan/step 的面板，客户端注入 display:none 隐藏；
  会话重新运行恢复；
- 设置项 `autoCollapseCompletedTasks`（默认开）；
- 每次收起写 `[task-panel]` 日志（含 class/text 样本），便于确认启发式命中是否正确。

## 迁移向导

- 诊断面板「迁移向导」：先展示稳定性汇总，再选择
  「继续使用开发服务(3080)」/「切换到 root 测试(3081)」/取消；
- 切换仅重启界面，不重启后台服务。

## GitHub 客户端更新检查

- 菜单「从 GitHub 检查客户端更新…」/ 诊断面板按钮：GitHub Releases API
  获取最新 tag 与发布说明，对比当前版本；
- 有更新时弹窗可「打开下载页」或「查看发布说明」，不自动下载安装；
- 失败/限流会记录日志并弹错误提示。

## 性能基线

- `scripts/perf-baseline.js` / `npm run perf:baseline`：采样客户端与两个服务的
  CPU/PSS，写 `~/.config/dsh-desktop/perf-baseline.json`；
- `docs/PERF.md` 记录方法与本次基线（客户端 0.5%/459 MiB，开发服务 0.9%/574 MiB）。

## 说明

- 图片「发送后消息预览」仍依赖 dsh 前端与模型配置，自动化只验证到输入区附件；
  真实发送预览建议手动确认（避免自动化触发真实模型调用）。
- 测试 30/30。
