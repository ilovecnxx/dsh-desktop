# DSH Desktop 1.4.7：粘贴/文件夹 IPC 注册修复与端到端验证

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 修复

之前 1.4.2/1.4.6 中新增的以下 IPC handler 被插到了不存在的锚点，实际没有注册：

- `dsh:get-paste-config`
- `dsh:save-pasted-text`
- `dsh:save-pasted-file`
- `dsh:open-dropped`

结果：长文本粘贴转文件、粘贴图片保存、文件夹拖入均会报
`No handler registered for 'dsh:save-pasted-text'` 或静默失败。
1.4.7 统一注册到 `registerIpc()`，与 `dsh-desktop:*` 处理器在同一处。

## 端到端验证（真实渲染进程）

测试钩子：`DSH_DESKTOP_TEST_SIMULATE_PASTE=<长文本>`（仅测试环境；preload 收到
test-mode 后暴露 `__dshDesktopTest.pasteText`）。

实测结果：

```
[test] 模拟长文本粘贴 8400 字符 -> /tmp/ui-test/pastes/paste-...-<首行摘要>.txt
[test] 输入框尾部: "/tmp/ui-test/pastes/paste-...-<首行摘要>.txt"
[test] pastes 目录: ["paste-...-<首行摘要>.txt"]
```

即：长文本 → 阈值判断 → IPC 保存文件 → 路径插入输入框，全链路通过。

## 目录拖拽 / 图片

- 文件夹：`dsh:open-dropped` 已注册，会为文件夹启动独立 `dsh web` 实例并开新窗口
  （模块已在隔离环境实测：随机端口、token 解析、HTTP 303、关闭即停）。
- 图片/文件：路径注入逻辑已注册；真实拖拽/剪贴板图片需要手动在客户端窗口验证
  （自动化无法构造带真实路径的 DataTransfer）。

## 测试

- `npm test`：28/28 通过。
