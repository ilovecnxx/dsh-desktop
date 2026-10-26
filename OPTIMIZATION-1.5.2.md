# DSH Desktop 1.5.2：测试、性能与修复

2026-10-26。

## 测试

- 单元测试 30/30；
- 语法检查全部 JS；
- stub e2e（长文本 8400 字符转文件）；
- 真实附件 e2e（三图 chips=3、粘贴 chips=6）；
- `electron-builder --linux dir` 打包成功；
- CI v1.5.1：CI / E2E / Release 全部 success。

## 修复

- root 模式共享 `~/.dsh` 时，普通用户服务偶发
  `EACCES: scandir ~/.dsh/sessions/...`：
  - `dsh-owner-sync.service` 改为只处理非 user 文件、10 秒间隔；
  - 切换到 3080 / 客户端外部模式连接 3080 前先执行 `dsh-fix-owner`；
- `perf-baseline.js` HZ 改为 `os.constants.SC_CLK_TCK`；
- 诊断面板新增「重新加载界面」释放渲染进程内存（长会话）。

## 性能

- owner-sync：约 2% → 约 0.5% CPU；
- 任务运行中客户端：主进程 17.9% / 渲染 8.2%，PSS 约 999 MiB（超长会话）；
- 空闲基线仍为 0.5% / 459 MiB。

报告详见 `docs/TEST-REPORT-1.5.1.md`。
