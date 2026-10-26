# 官方桌面端功能对照（Linux 客户端）

参考：官方 `apps/desktop/README.zh.md`（DeepSeek Harness Desktop，macOS/Windows）。

| 官方能力 | 本客户端 | 说明 |
|---|---|---|
| Electron 壳 + dsh Web | ✅ | 直接加载本地 dsh web，externalService 模式 |
| 单实例锁 | ✅ | `requestSingleInstanceLock` |
| dsh:// 协议 | ✅ | `dsh://new` / 打开窗口 |
| 关于面板 | ✅ | 版本、dsh、Electron/Node、服务模式、GitHub 地址 |
| 管理 dsh 命令 | ✅（简化） | 检查 dsh 路径/版本，复制安装命令；不自带 pnpm/runtime |
| 关闭窗口隐藏/托盘 | ✅ | 关闭行为可配置（托盘/退出/彻底退出） |
| 退出时任务运行确认 | ✅ | 会话运行中退出会二次确认 |
| 托盘图标/菜单/点击显示 | ✅ | AppIndicator + 菜单；tooltip 显示模式 |
| 开发者工具 F12 / Ctrl+Shift+I | ✅ | WebContents 拦截，打包版也可用 |
| 通知（任务完成/审批） | ✅ | 窗口未聚焦时系统通知 |
| 设置/诊断/回滚/更新检查 | ✅ | 诊断面板、GitHub 检查、稳定性报告 |
| GitHub 状态 | ✅ | Stars/Forks/issue/最新 Release/CI/E2E 状态 |
| 附件拖拽/粘贴 | ✅ | 交由 dsh 原生处理（最多 20 张/20MB） |
| 多窗口/最近会话/工作区 | ✅ | 含最近工作区、闲置回收、工作区上限 |
| 语言 | ⚠️ 仅中文 | 官方支持 8 种内置语言；本客户端界面以中文为主 |
| 可配置快捷键 | ⚠️ 未实现 | 官方有 keybindings.json；本客户端用固定快捷键 |
| 自带运行时（Node/pnpm/Python） | ⚠️ 未实现 | 官方内置 runtime；本客户端依赖系统全局 dsh |
| 平台账号/Platform 内嵌页 | ❌ 不适用 | 本地 dsh 无账号体系 |
| 原生 Windows 顶栏/安装器/签名更新 | ❌ 不适用 | Linux 平台；.deb/AppImage 更新未签名 |
| 麦克风/内嵌浏览器分区 | ⚠️ 部分 | Electron 默认权限；无 Platform 账号分区需求 |

## 后续可补

1. 可配置快捷键（keybindings.json）
2. 多语言（中/英切换）
3. 壳自动更新（从 GitHub Release 下载并替换）
4. 自带运行时（内置 Node + dsh，摆脱全局安装）

## 验证

- `npm test`：30/30；
- GitHub 状态需要网络与 GitHub API（未认证有速率限制，失败会提示）。
