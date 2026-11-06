---
name: account-manager
description: 管理与切换 Antigravity 的 Google 登录账号，支持多账号查看、一键切换与授权新增。
---

# Antigravity 账号管理器使用指南

本技能用于协助用户管理 Antigravity 2.0 桌面端应用中的多个 Google 账号。

## 核心能力
1. **查看账号**：读取本地保存的 Google 账号列表与当前激活账号。
2. **切换账号**：一键切换 Antigravity 的底层凭据，让客户端即时生效。
3. **新增账号**：拉起默认浏览器进行 Google OAuth 2.0 授权登录并自动导入。

## 常用操作命令
- 安装并热注入插件：`node install.js`
- 卸载插件并移除界面按钮：`node uninstall.js`
