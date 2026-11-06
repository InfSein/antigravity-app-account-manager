# Antigravity 账号管理插件规则 (AGENTS.md)

## 项目定位
本插件为 Antigravity 2.0 桌面端应用提供原生风格的 Google 多账号快速切换与管理能力。

## 核心设计规范
1. **界面集成**：
   - 账号按钮必须挂载在侧边栏左下角“设置”按钮（`button[data-testid="settings-button"]`）的正上方。
   - 样式必须严格契合 Antigravity 的原生侧边栏按钮样式，支持侧边栏折叠与展开。
2. **多账号存储**：
   - 本地账号数据持久化存储在 `~/.gemini/antigravity/account-manager-accounts.json`。
   - 文件权限控制为仅当前用户可读写 (`0600`)。
3. **凭据切换机制**：
   - Windows 环境优先更新 Windows 凭据管理器（Target: `gemini:antigravity`，User: `antigravity`）。
   - 同时同步写入 `~/.gemini/jetski-standalone-oauth-token`、`~/.gemini/oauth_creds.json`、`~/.gemini/antigravity/active-account.json`。
   - 生成全新的随机 `writer_id`，以触发 `language_server` 的 `syncWithStoredToken` 机制。
4. **Google 授权流程**：
   - 使用 Google 官方 OAuth 授权流程，参数包含 `prompt=select_account consent`，确保用户能够自由选择或添加新账号。
   - 本地临时 HTTP 服务用于接收回调，并在成功后自动关闭。
5. **代码规范**：
   - 所有文件必须使用 UTF-8 编码。
   - 代码关键逻辑必须包含清晰中文注释。
   - 保持零第三方 npm 依赖，完全依赖 Node.js 22 内置能力。
