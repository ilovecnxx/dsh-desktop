# DSH Desktop 1.2.3 优化记录

2026-10-26（Asia/Shanghai）。本版本只改桌面端，官方 `dsh` 核心未修改。

## 背景

- `rollout.log` 中出现 `GPU process isn't usable. Goodbye.`：XWayland 客户端在
  本机显卡/驱动组合下 GPU 进程反复崩溃后整个应用直接退出，没有恢复路径。
- `main.log` / `server.log` 只追加不轮转，长期运行会无限增长，也拖慢诊断读取。

## 改动

1. **GPU 崩溃自动降级**
   - 监听 `app.on('child-process-gone')` 中 `type === 'GPU'` 的崩溃。
   - 10 分钟窗口内崩溃达到 2 次时：系统通知 + 对话框，用户确认后写入
     `config.softwareRendering = true` 并重启客户端（先停止服务，会话记录保留）。
   - `scripts/launch-app.sh` 读取该配置（或 `DSH_DESKTOP_SOFTWARE_RENDERING=1`），
     追加 `--disable-gpu` 启动。
   - 设置窗口新增「软件渲染」开关；诊断面板与「关于」显示当前状态。
   - 策略函数抽到 `runtime-utils.shouldFallbackToSoftwareRendering`，可单测。
2. **日志轮转**
   - `runtime-utils.rotateIfNeeded(file, 2 MiB)`：超过上限时重命名为 `<file>.1`，
     覆盖旧备份，只保留一份。
   - 主进程启动时检查一次；运行中每写 200 行检查一次。
   - 服务每次启动时检查一次 `server.log`。
3. **测试与文档**
   - 新增 `test/optimizations.test.js`（日志轮转、GPU 策略、壳更新原子替换/回滚）。
   - README、CHANGELOG 同步；本文件记录改动与验证。

## 验证

- `npm test`：**11/11 通过**（原 8 项 + 新增 3 项）。
- 隔离实例模拟 GPU 崩溃（`DSH_DESKTOP_TEST_GPU_CRASH_MS=4000`、
  `DSH_DESKTOP_TEST_GPU_FALLBACK=1`）：两次崩溃后日志出现
  「GPU 进程 10 分钟内反复崩溃，准备切换到软件渲染」，
  `config.json` 写入 `"softwareRendering": true`。
- 预置 3 MiB 的 `main.log`/`server.log` 后启动：两者均轮转为 `.1`，
  新日志分别约 0.8 KiB/0.4 KiB；主日志与服务日志读取不再增长。
- 安装版启动器在 `softwareRendering=true` 的配置下会带 `--disable-gpu` 启动
  （通过进程参数核对）。
- 真机安装后热切换生效（不重启 `dsh web` 服务，会话不中断）。

## 回滚

- 代码回滚：`git checkout v1.2.2`（或 `git revert <commit>`）。
- 客户端回滚：`~/.local/opt/dsh-desktop/resources/app.backup` 为壳自更新保留的上一版。
- 关闭软件渲染：设置窗口取消勾选，或把 `config.json` 的 `softwareRendering` 改为 `false`，
  重启客户端。
