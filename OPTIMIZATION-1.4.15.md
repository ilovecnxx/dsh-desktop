# DSH Desktop 1.4.15：GPU 稳定性修复与观察自动化

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 现象与修复

观察期第一次快照发现：客户端短时间内再次因 GPU 进程启动失败
（`launch-failed exitCode=1002`）崩溃并自动重启。虽然已启用软件渲染
（`--disable-gpu`），Chromium 仍会拉起独立 GPU 进程，反复失败会触发致命退出。

修复（`scripts/launch-app.sh`，软件渲染模式）：

```bash
--disable-gpu --in-process-gpu --disable-gpu-process-crash-limit
```

- `--in-process-gpu`：GPU 不再作为独立子进程启动，从根上消除该类
  `GPU process launch failed` 崩溃；
- `--disable-gpu-process-crash-limit`：双保险，避免崩溃达到上限后强制退出。

## 稳定性观察自动化

- `scripts/stability-snapshot.js`：采集时间、版本、客户端 PID、3080/3081 端口、
  dev/root 服务 active 状态、`stability.json`、近期错误，追加到
  `~/.config/dsh-desktop/observation.jsonl`。
- systemd 用户定时器 `dsh-desktop-observe.timer`：每日 00:00（Persistent），
  已 enable 并生成首次快照。

## 验证

- 客户端重启后命令行确认包含 `--in-process-gpu`；
- 重启后 20 秒内无新的 `GPU 进程退出` 日志；
- `npm test`：30/30 通过。
