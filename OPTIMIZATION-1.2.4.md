# DSH Desktop 1.2.4 修复记录

2026-10-26。本版本只改桌面端，官方 `dsh` 核心未修改。

## 问题

1. **顶栏（系统托盘）点击没有反应**
   - 根因：`bootstrap()` 先调用 `refreshMenus()` 再 `createTray()`，而 `createTray()`
     只设置 tooltip 和 click 监听、没有绑定 context menu。Linux（AppIndicator/SNI）
     下托盘点击行为完全依赖 context menu，第一次自动更新检查（约 30 秒）触发的
     `refreshMenus()` 之前，托盘等于没有菜单。
2. **关闭前台后后台继续运行，容易被误认为程序已退出**
   - 旧实现固定“关闭即隐藏到托盘”，且托盘未绑定时无法找回窗口。

## 改动

- `createTray()` 创建后立即 `tray.setContextMenu(buildTrayMenu(menuContext()))`，
  并记录“系统托盘已创建并绑定菜单”；启动顺序改为 `createTray()` → `refreshMenus()`。
- 新增 `closeAction` 配置与设置项：
  - `tray`（默认）：关闭窗口收进托盘；
  - `quit`：关闭窗口即退出客户端（保留后台/网页服务）；
  - `quit-all`：关闭窗口即彻底退出（同时停止后台服务）。
- 托盘不可用时关闭窗口改为最小化并通知，避免“窗口消失且无法找回”。
- 兼容旧配置：缺少 `closeAction` 时按 `closeToTray` 迁移。
- 新增 `resolveCloseAction` 单元测试。

## 验证

- `npm test`：12/12 通过。
- 隔离实例启动日志出现「系统托盘已创建并绑定菜单」，DBus
  `org.freedesktop.StatusNotifierItem-<pid>-1` 正常注册。
- 设置窗口可选择关闭行为并持久化；托盘菜单含「打开主窗口」「彻底退出（含网页服务）」等。
- 安装 1.2.4 后热切换生效，服务未中断。

## 回滚

`git checkout v1.2.3`；或删除配置里的 `closeAction`（回退到 `closeToTray` 行为）。
