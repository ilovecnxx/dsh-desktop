# DSH Desktop 1.4.14：CI e2e 稳定化

2026-10-26。只改桌面端，官方 `dsh` 核心未修改。

## 问题

CI 里没有真实会话/模型配置，合成拖拽落到引导页上，附件区不存在，导致
`E2E attachments` 失败（drop/paste chips=0）。

## 方案

- CI 使用 `E2E_STUB=1`：客户端加载 `test/fixtures/stub.html`（带 textarea 的
  最小页面），直接验证客户端自己的链路：
  `长文本粘贴 → 阈值判断 → IPC 保存 txt → 路径插入输入框`。
- 真实 dsh 的「多图拖拽 + 剪贴板截图粘贴」继续在本地用
  `node scripts/e2e-attachments.js` 验证（已通过：
  `{"drop":{"chips":3,"fullscreenBlur":0},"paste":{"chips":6}}`）。
- `DSH_DESKTOP_TEST_SIMULATE_PASTE` 现在会主动重发 test-mode，确保 stub 页面上
  `__dshDesktopTest` API 已注入。
- CI：`.github/workflows/e2e.yml` 不再安装 dsh，只装 xvfb + Electron，
  `E2E_STUB=1 xvfb-run -a node scripts/e2e-attachments.js`。

## 验证

- GitHub Actions `E2E attachments`：**success（32s）**；
- 本地 stub 运行：`E2E_PASTE {"chars":"8400","path":".../pastes/...txt","composer":"...pastes..."}`；
- `npm test`：30/30 通过。
