# DSH Desktop 1.4.22：切换配置落盘修复

2026-10-26。

## 现象

切到 root 模式后，日志显示切换成功、客户端也重启了，但新客户端仍连接 3080，
工具身份仍是 user；切回普通模式同样没有真正切换。

## 根因

- `Config.set()` 采用 **200ms 防抖** 保存；
- `switchService()` 调用 `config.set('port', target)` 后调用 `relaunchClient()`，
  旧进程在 **150ms** 后 `app.exit(0)`，防抖定时器还没执行；
- 新客户端重新读取 `config.json`，端口仍是旧值 3080。

## 修复

- 切换时写完 `port`/`externalService`/`useSystemdService` 后显式调用
  `config.save()` 同步落盘（原子写 + rename），再执行延迟重启；
- 日志增加「配置已落盘」，便于确认。

## 验证

- `npm test`：30/30；
- 客户端重启到 1.4.22 后，切换 3080 ↔ 3081 会真正改变连接端口。
