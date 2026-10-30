# DSH Desktop 1.7.0：桌面端只负责显示 + 后台兼容修复

2026-10-30。

## 架构简化

- 移除桌面端「第三方 API 接入」窗口及其 IPC/凭据写入逻辑；
- 桌面端不再直接修改 `~/.dsh/profiles/web/cordis.patch.yml` 或 `.credentials.yaml`；
- 设置窗口只保留只读提示：模型/第三方 API 请在 **dsh 设置 → 模型 → 添加模型提供商** 配置。

## 后台兼容修复（dsh rc.5）

- `@deepseek-ai/dsh-subagent-codex`、`dsh-subagent-claude-code` 升级到 **0.2.1-rc.5**；
- 第三方插件升级到兼容 rc.5 的版本（codex-ui、skills-manager、im、sidebar、
  context、cost-meter、mnemon、market、genui）；
- `dsh --profile web --dump-config` 无插件不兼容警告；
- 升级前已备份 profile 的 package.json/pnpm-lock。

## 开机稳定性

- 用户服务 `ExecStartPre`：先停 root 服务/owner-sync，再等待 `/usr/bin/dsh` 就绪
  （避免 dsh 升级期间 flock 找不到二进制导致 1000+ 次重启）；
- `After=network-online.target`；
- 客户端普通模式启动时自动停掉 root 双服务、同步属主，避免双服务共享 `~/.dsh` 冲突。

## 验证

- 单测 30/30；
- 插件兼容性 dump-config 检查通过；
- 客户端/服务重启后按普通模式运行，配置统一由 dsh Web 设置管理。
