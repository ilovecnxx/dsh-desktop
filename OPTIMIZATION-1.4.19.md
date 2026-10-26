# DSH Desktop 1.4.19：诊断服务切换 action 修复

2026-10-26。

## 问题

诊断面板点击「连接开发服务(3080)」/「连接 root 测试(3081)」/「启动 root 服务」/
「停止 root 服务」时报：

```
Error invoking remote method 'diagnostics:action':
Error: 未知操作: switch-test-service
```

## 原因

`switchService()`、`controlRootService()` 函数与 utility 按钮、action 映射都已存在，
但主进程 `handleUtilityAction` 的 switch 分发漏了这四个 case，落到 default 抛错。

## 修复

在 `handleUtilityAction` 补齐：

- `switch-dev-service` → `switchService(3080, '开发服务')`
- `switch-test-service` → `switchService(3081, 'root 测试服务')`
- `root-service-start` → `controlRootService('start')`
- `root-service-stop` → `controlRootService('stop')`

## 验证

- `npm test`：30/30；
- 客户端重启到 1.4.19 后，可在诊断面板切换服务（仅重启界面，不重启后台服务）。
