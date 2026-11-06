# Antigravity 账号管理插件 (Antigravity Account Manager)

一款专为 Antigravity 2.0 桌面应用打造的 Google 多账号快速切换与管理插件。在侧边栏左下角“设置”按钮上方无缝新增 Google 账号按钮，支持当前登录账号自动保存、多账号一键切换以及授权新增 Google 账号。

---

## 搜索记录

在项目启动与研发前，我们对 GitHub、skills.sh 以及本地环境进行了调研与方案分析，关键发现与结论如下：

1. **凭据存储与校验机制**：
   - 参考了 GitHub 上已有的开源实现（如 `Draculabo/AntigravityManager`、`lbjlaq/Antigravity-Manager`、`Muriel-Gasparini/antigravity-account-switcher`、`fikrilal/agy-auth`）以及 `antigravity-ide-cockpit` 的账号管理实现。
   - Antigravity 2.0 采用 `CompositeTokenStorage` 体系，核心凭据优先保存在系统的原生安全凭据库中：
     - **Windows**：保存在 Windows 凭据管理器（Target: `gemini:antigravity`，用户名: `antigravity`，类型: Generic）。
     - **备用/跨平台文件**：同步备份于 `~/.gemini/jetski-standalone-oauth-token`、`~/.gemini/oauth_creds.json` 与 `~/.gemini/antigravity/active-account.json`。
   - `language_server.exe` 的内部 `AuthClient` 会将 `writer_id` 作为凭据版本的指纹。当写入新的账号 Token 并更新随机 `writer_id` 时，系统会自动执行 `syncWithStoredToken`，无需重启整个应用即可识别新的凭据。

2. **Google OAuth 2.0 网页授权机制**：
   - 官方 OAuth 授权端点为 `https://accounts.google.com/o/oauth2/v2/auth`，Token 交换端点为 `https://oauth2.googleapis.com/token`。
   - 授权参数中必须携带 `prompt=select_account consent`，以确保在浏览器已有登录会话时仍强制弹出账号选择面板，支持自由登录新账号。
   - 本地临时 HTTP 服务通过动态端口接收 `/callback` 回调，并通过 PKCE（`code_verifier` / `code_challenge`）完成安全握手。

3. **界面挂载与热注入技术**：
   - Antigravity 2.0 应用常驻开启了 CDP 调试通道（端口记录于 `%APPDATA%\Antigravity\DevToolsActivePort`）。
   - 界面左下角的“设置”按钮具有明确选择器 `button[data-testid="settings-button"]`，在其父容器内部前置插入账号按钮，即可完全继承其栅格排版、内边距与折叠动画表现。

---

## 功能特性

- **自动侦测与保存**：插件初次加载时自动读取当前系统已登录的 Google 账号凭据，持久化至插件安全存储。
- **无缝原生风格**：账号按钮挂载在设置按钮正上方，支持侧边栏展开与折叠自适应。
- **一键平滑切换**：多账号之间即时切换，并在必要时自动通过 `refresh_token` 提前刷新即将过期的凭据。
- **授权新增账号**：点击“添加 Google 账号”可自动调起浏览器 Google 登录，授权成功后自动同步并切换至新账号。
- **零外部 npm 依赖**：纯依靠 Node.js 22 全局 WebSocket 与系统原生 API，开箱即用，轻量极速。
- **网络自适应**：支持自动读取 Windows 系统代理与 HTTP CONNECT 隧道代理，保证国内网络环境下 Google 认证畅通无阻。

---

## 快速安装与使用

### 1. 一键安装并热注入
在当前插件目录中执行：
```bash
node install.js
```
该命令会自动将插件同步至 `~/.gemini/config/plugins/antigravity-account-manager`，并在当前运行的 Antigravity 窗口中立刻激活账号按钮！

### 2. 一键卸载
如需卸载插件：
```bash
node uninstall.js
```

---

## 文件结构一览

```
antigravity-app-account-manager/
├── plugin.json             # 插件清单定义
├── hooks.json              # 生命周期钩子
├── AGENTS.md               # 插件规则与开发规范
├── ARCHITECTURE.md         # 架构设计与调用关系图
├── README.md               # 项目介绍与搜索记录
├── install.js              # 一键安装与热注入脚本
├── uninstall.js            # 一键卸载与清理脚本
├── package.json            # 项目配置
├── assets/
│   └── logo.svg            # 插件图标
├── sidecars/
│   └── manager/
│       ├── sidecar.json    # 伴随进程配置
│       └── main.mjs        # 伴随进程启动入口
├── src/
│   ├── constants.js        # 路径与凭据常量
│   ├── credential_manager.js # 系统凭据 (WinCred) 读写
│   ├── account_store.js    # 账号本地持久化存储
│   ├── oauth_service.js    # Google OAuth 授权与刷新
│   ├── account_switcher.js # 账号切换核心逻辑
│   ├── cdp_injector.js     # CDP WebSocket 注入与双向通信
│   └── ui_script.js        # 前端界面按钮与弹窗渲染脚本
├── scripts/
│   └── session_hook.js     # 会话启动热注入钩子
└── skills/
    └── account-manager/
        └── SKILL.md        # 智能体使用指南
```
