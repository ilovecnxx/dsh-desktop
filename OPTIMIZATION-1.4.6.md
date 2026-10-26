# DSH Desktop 1.4.6：文件夹工作区与双轨环境

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 文件夹作为独立工作区

- 交互：
  - 把文件夹拖到客户端窗口：自动为新文件夹启动独立 `dsh web` 实例并开新窗口；
  - 菜单「打开文件夹作为工作区…」可选文件夹；
- 实现（`main/workspace-service.js`）：
  - `cwd` = 目标文件夹，端口随机空闲端口；
  - 从子进程 stdout 解析带 token 的地址，超时 45 秒；
  - 窗口关闭时 `stop()`（SIGTERM 给进程组）释放服务；
  - 拖拽同时包含文件时：文件夹打开新窗口，文件仍插入路径。
- 注意：每个工作区实例是一个独立 dsh web 进程（约 1 GB 内存），用完关窗即可。

## root 测试环境完善

- `dsh-web-root.service` 现在设置：
  - `HOME=/home/user`、`PATH=/home/user/.local/bin:...`；
  - `DSH_HOME=/home/user/.dsh-root`（与开发端 `~/.dsh` 隔离，避免 root 属主污染）；
- 开发端 3080（用户级 systemd 服务）与 root 测试端 3081 可同时运行；
- 客户端诊断面板可在两者之间切换（外部服务模式）。

## 诊断信息

- 诊断面板新增「当前 HOME」一行；「服务托管」行显示外部服务端口（如 `外部服务 3080`）。

## 验证

- `npm test`：28/28 通过（新增端口、非法文件夹校验）。
- 工作区服务实测：隔离 DSH_HOME 下启动成功，HTTP 303，关闭后进程退出。
- 双轨：3080/3081 同时监听，root 服务 `HOME=/home/user`、`DSH_HOME=/home/user/.dsh-root`。
