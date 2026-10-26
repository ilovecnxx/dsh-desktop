# DSH Desktop 1.5.1 测试与性能报告

日期：2026-10-26
环境：Linux（Wayland），客户端 1.5.1，当前 root 模式（3081），工具进程 root。

## 1. 自动化测试

| 项目 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm test` | **30/30 通过** |
| 语法检查 | `node --check`（main/preload/scripts 全部 JS） | 全部通过 |
| 长文本 e2e（stub） | `E2E_STUB=1 node scripts/e2e-attachments.js` | 通过：8400 字符 → `pastes/...txt` → 路径插入输入框 |
| 附件 e2e（真实 dsh） | `node scripts/e2e-attachments.js` | 通过：三图拖拽 `chips=3, fullscreenBlur=0`；截图粘贴 `chips=6` |
| 打包构建 | `npx electron-builder --linux dir` | 成功（`dist/linux-unpacked`） |
| CI（v1.5.1） | GitHub Actions | `CI` / `E2E attachments` success；`Release Linux packages` success |

## 2. 日志审计

- `main.log`：只有 05:30–05:34 的启动失败历史（已由 1.4.22 修复），1.5.x 无新增错误。
- `systemd-server.log`：发现 `EACCES: permission denied, scandir ~/.dsh/sessions/session-...`，
  根因是 root 模式写入的会话目录属主/权限与普通用户服务切换时的短暂窗口。
- 修复：
  - `dsh-owner-sync.service` 优化为只对非 user 文件执行 chown，间隔 10 秒；
  - 切回 3080 及客户端以外部模式连 3080 时，先执行 `dsh-fix-owner` 再启动服务。

## 3. 性能测量

测量工具：`scripts/perf-baseline.js`（`PERF_SECONDS=10`）。

| 场景 | 客户端 CPU | 客户端 PSS | root 服务 CPU/PSS |
|---|---|---|---|
| 任务运行中（本会话长历史） | 主进程 ~17.9%，渲染 ~8.2% | ~999 MiB | 0.7% / ~760 MiB |
| 空闲（docs/PERF.md 基线） | 0.5% | 459 MiB | — |

说明：
- 软件渲染 + `--in-process-gpu` 会把合成工作放到主进程，因此任务运行/流式渲染时主进程
  CPU 偏高；换取的是不再出现 GPU 进程 `launch-failed` 崩溃。
- 客户端 PSS 偏高主要来自超长会话 DOM（60+ 轮），不是泄漏；可用诊断面板
  「重新加载界面」释放渲染进程内存。
- `dsh-owner-sync` 优化后 CPU 从约 2%（3 秒间隔）降到约 0.5%（10 秒间隔）。

## 4. 本轮修复

1. owner-sync 按需 chown + 10 秒间隔，降低常驻 CPU。
2. 切换/连接 3080 前自动修复 `~/.dsh` 属主，避免 EACCES。
3. `perf-baseline.js` 修正 HZ 硬编码（改用 `os.constants.SC_CLK_TCK`）。
4. 诊断面板新增「重新加载界面」，便于长会话释放内存。

## 5. 建议

- 超长会话建议定期点「重新加载界面」或重启客户端界面；
- 如需更低 CPU，可在设置里把「界面动效」改为「始终暂停」；
- GPU 稳定性与 CPU 是取舍：当前选择稳定优先（软件渲染 + in-process GPU）。
