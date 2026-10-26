# DSH Desktop 1.4.23：服务模式快捷切换

2026-10-26。

## 快捷切换

- 托盘菜单与应用菜单新增「服务模式」子菜单：
  - 开发服务(3080, user)
  - root 测试(3081)
  - 当前模式 radio 打勾；
- 点击后执行原有切换流程：停另一个服务释放会话锁 → 启动目标服务 →
  同步落盘配置 → 延迟重启客户端；
- 托盘 tooltip 显示当前模式。

## 免密 root 服务助手

- 新增 `/usr/local/sbin/dsh-root-service`（start/stop/restart/is-active），
  由 `scripts/setup-root.sh` 安装并写入 sudoers；
- 切换 root 服务优先用 `sudo -n` 调用助手，不再每次弹密码；
- 助手不存在或失败时自动回退 `pkexec`。

## 验证

- `sudo -n /usr/local/sbin/dsh-root-service is-active` → `active`；
- `npm test`：30/30；
- 客户端重启到 1.4.23，托盘菜单可直接切换服务模式。
