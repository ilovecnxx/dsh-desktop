# 打包与发布

## 本地构建

```bash
npm install
npm run dist:linux        # .deb + AppImage -> dist/
# 或只构建解包目录（调试用）
npm run dist:dir          # dist/linux-unpacked/
```

产物：

- `dist/dsh-desktop_1.3.0_amd64.deb`
- `dist/DeepSeek-Harness-1.3.0.AppImage`

依赖：Node.js ≥ 20、网络可访问 GitHub（首次构建会下载 Electron 及 AppImage 工具）。

## 安装

```bash
sudo dpkg -i dist/dsh-desktop_1.3.0_amd64.deb   # Debian/Ubuntu
# 或
chmod +x dist/DeepSeek-Harness-1.3.0.AppImage && ./dist/DeepSeek-Harness-1.3.0.AppImage
```

打包版与用户目录版共用 `~/.dsh` 会话数据；如需卸载 `sudo apt remove dsh-desktop`。

## 发布流程

1. 更新 `package.json` 版本并提交；
2. `git tag v1.3.0 && git push origin v1.3.0`；
3. GitHub Actions `Release Linux packages` 自动：
   - `npm ci --ignore-scripts`
   - `npm test`
   - `npx electron-builder --linux deb AppImage`
   - 把 `.deb` 与 AppImage 附加到对应 Release。

## 说明

- 打包版使用 asar，不包含用户目录启动器 `~/.local/bin/dsh-desktop`；
  桌面客户端自更新/开机自启以用户目录版为主。
- 版本号需与 tag 一致（tag 形如 `v1.3.0`）。
