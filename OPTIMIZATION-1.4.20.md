# DSH Desktop 1.4.20：模式切换与服务自动拉起

2026-10-26。

## 问题

1. 诊断面板切换模式后，目标服务没启动，前端加载失败；
2. 切到 root 模式后看不到之前的项目/会话（root 服务用的是独立 `~/.dsh-root`）。

## 修复

### 切换时自动拉起目标服务

`switchService()` 现在会先确保目标服务就绪，再写配置并 `app.relaunch()`：

- 3080：`systemctl --user start dsh-web-session.service`
- 3081：`pkexec systemctl start dsh-web-root.service`（弹一次图形密码授权）
- 轮询端口最多 25 秒；失败返回明确错误，不重启界面。

### root 模式共享会话/项目

- `dsh-web-root.service` 的 `DSH_HOME` 改为 `/home/user/.dsh`（与开发端一致），
  切换后能直接看到原有会话/工作区；
- 新增系统级 `dsh-owner-sync.service`：root 模式运行期间每 5 秒
  `chown -R user:user /home/user/.dsh`，保证普通模式仍可读写 root 写入的文件。

## 注意

- 共享 home 下 root 服务写文件会有最多约 5 秒的属主延迟，由 owner-sync 兜底；
- 若在 root 模式生成大量文件，可手动执行 `sudo /usr/local/sbin/dsh-fix-owner`；
- 切换仍只重启客户端界面，不重启后台服务。

## 验证

- root 服务 `systemctl show -p Environment` 为 `DSH_HOME=/home/user/.dsh`；
- `dsh-web-root.service`、`dsh-owner-sync.service` 均 active；
- 测试 30/30。
