# DSH Desktop 1.5.4：修复 root 模式项目会话「未分组」

2026-10-26。

## 现象

切换到 root 模式后，原项目（如 linux-android / 安卓手机移植）下的会话显示在「未分组」。

## 原因

1. `~/.dsh/storages/workspace.json` 中部分会话没有出现在对应工作区的
   `sessionIds` 里（注册表关联丢失），UI 的 `groupByWorkspace` 会把它们归入
   「未分组」（本次审计：8 个，其中 linux-android 5 个、default-workspace 3 个）。
2. root 服务 `WorkingDirectory=/home/user`，与开发端
   `/home/user/文档/deepseek-harness/default-workspace` 不一致，新会话可能落到错误工作区。

## 修复

- 新增 `scripts/repair-workspace-groups.js`：
  - 读取每个 session 文件首行元数据（cwd/id）；
  - 按 cwd 匹配工作区，把未关联的会话追加回 `sessionIds`；
  - 写盘前备份 `workspace.json.bak-<时间>`；支持 `--dry-run`。
- 两个 systemd 服务的 `WorkingDirectory` 统一为 `default-workspace` 并 daemon-reload；
- 建议修复时先停 dsh 服务，避免注册表被运行中的服务覆盖。

## 结果

- dry-run/实际修复 8 个游离会话；
- 重启 root 服务并重载客户端后，项目会话回到对应工作区分组。

## 验证

- `node scripts/repair-workspace-groups.js --dry-run` 输出待修复列表；
- 修复后 `workspace.json` 对应工作区 `sessionIds` 增加；
- 测试 30/30。
