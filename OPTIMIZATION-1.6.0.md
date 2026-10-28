# DSH Desktop 1.6.0：第三方 API 接入

2026-10-28。

## 功能

设置 →「第三方 API 接入」（或应用菜单同名入口）打开管理窗口：

- 支持协议：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages；
- 适用：OpenAI、Anthropic、Kimi、自建/中转 OpenAI 兼容网关；
- 字段：路由名、显示名、API 地址、API 密钥、模型 ID 列表（可选显示名）；
- 操作：保存并写入 DSH、测试连接、清空、重启服务、打开凭据目录；
- 支持编辑/删除已有提供商；可勾选「设为默认模型」。

## 写入位置

- 提供商配置：`~/.dsh/profiles/web/cordis.patch.yml`
  - 托管块 `# >>> dsh-desktop third-party providers ...`
  - 写入 `llm-pi-ai` 的 `providers`；可选写入 `agent-default-model`；
- API 密钥：`~/.dsh/.credentials.yaml` 的 `refs`
  - 引用名规则：`<ROUTE>_API_KEY`（大写下划线）；
  - 文件权限 600，dsh-credentials-local 自动重载；
- 客户端自身只保存路由/地址/模型（`third-party-apis.json`），不保存明文密钥。

## 安全/边界

- 密钥只写本地凭据文件，不写 profile patch、不写客户端日志；
- 「测试连接」只请求 `/models`，不发送对话内容；
- 与 dsh Web 设置页同时编辑同一 profile 时，以最后一次写入为准；
- 「设为默认模型」会把 agent 默认模型切到该提供商第一个模型（reasoning 采用供应商默认）。

## 验证

- 单元测试 30/30；
- 临时目录写盘测试：patch 与 credentials 均为合法 YAML，DSH `--dump-config`
  能解析 providers 与 agent-default-model；
- UI 内联脚本通过 `node --check`。
