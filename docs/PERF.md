# DSH Desktop 性能基线

## 测量方法

```bash
npm run perf:baseline          # 默认采样 10 秒
PERF_SECONDS=8 npm run perf:baseline
```

- 脚本：`scripts/perf-baseline.js`
- 采样对象：桌面客户端进程树、3080 开发服务进程树、3081 root 服务进程树
- CPU：`/proc/<pid>/stat` utime+stime 差值 / 采样时长
- 内存：`/proc/<pid>/smaps_rollup` 的 PSS 求和
- 输出：`~/.config/dsh-desktop/perf-baseline.json`

注：普通用户读不到 root 进程的 smaps，root 服务的 PSS 显示 0 属于预期，
其实际占用约 0.9–1.1 GB（以 root 视角 `ps`/`smem` 为准）。

## 基线（2026-10-26，客户端 1.4.18-dev，软件渲染 + in-process GPU）

| 组件 | 进程数 | CPU | PSS |
|---|---|---|---|
| 桌面客户端（含渲染/GPU） | 7 | **0.5%** | **459 MiB** |
| 3080 开发服务（dsh web） | 6 | **0.9%** | **574 MiB** |
| 3081 root 测试服务 | 2 | 0% | 不可见（约 1 GiB） |
| 合计（可见部分） | 15 | **1.4%** | **1033 MiB** |

测量时：客户端窗口未聚焦（motionMode=auto 已暂停循环动画）、任务空闲。

## 历史参考

| 版本/场景 | 结果 |
|---|---|
| 1.2.6 前，会话运行中 | CPU 66%，GPU 25.4%，渲染 35.9% |
| 1.2.6 起，暂停循环动画 | CPU 8.2%，GPU 4.2%，渲染 3.1% |
| 空闲壳（无工作区） | CPU 0.2–0.5% |
| 每个文件夹工作区实例 | 约 1 GB 内存，闲置 10 分钟自动回收 |
| 1.4.15 起，软件渲染 | 增加 `--in-process-gpu`，消除 GPU 进程反复崩溃 |

## 回归阈值建议

- 客户端空闲 CPU < 2%，PSS < 650 MiB
- 3080 服务空闲 CPU < 5%
- 单客户端 + 单服务总内存 < 1.3 GiB（不含 root 测试服务）
- 任务运行中 CPU 明显升高属正常（动画/流式渲染），退出后应回落到上述基线

超过阈值时用 `npm run perf:baseline` 复测并对比本文件。
