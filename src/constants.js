/**
 * 常量定义模块
 * 统一管理插件涉及的路径、凭据标识、OAuth 配置和界面元素标识
 */
const path = require('path');
const os = require('os');

const HOME_DIR = os.homedir();
const APPDATA_DIR = process.env.APPDATA || path.join(HOME_DIR, 'AppData', 'Roaming');
const LOCALAPPDATA_DIR = process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local');

// 存储文件路径
const GEMINI_CONFIG_DIR = path.join(HOME_DIR, '.gemini');
const AGY_CONFIG_DIR = path.join(GEMINI_CONFIG_DIR, 'antigravity');
const STORE_FILE = path.join(AGY_CONFIG_DIR, 'account-manager-accounts.json');
const STANDALONE_TOKEN_FILE = path.join(GEMINI_CONFIG_DIR, 'jetski-standalone-oauth-token');
const OAUTH_CREDS_FILE = path.join(GEMINI_CONFIG_DIR, 'oauth_creds.json');
const ACTIVE_ACCOUNT_FILE = path.join(AGY_CONFIG_DIR, 'active-account.json');
const QUOTA_CACHE_FILE = path.join(AGY_CONFIG_DIR, 'quota-cache.json');
const DAEMON_PID_FILE = path.join(AGY_CONFIG_DIR, 'account-manager-daemon.pid');

// Antigravity 调试端口与可执行文件路径
const DEVTOOLS_PORT_FILE = path.join(APPDATA_DIR, 'Antigravity', 'DevToolsActivePort');
const AGY_PROGRAM_DIR = path.join(LOCALAPPDATA_DIR, 'Programs', 'antigravity');
const LANGUAGE_SERVER_EXE = path.join(AGY_PROGRAM_DIR, 'resources', 'bin', 'language_server.exe');

// Windows 凭据管理器常量
const WIN_CRED_TARGET = 'gemini:antigravity';
const WIN_CRED_USER = 'antigravity';

// Google OAuth 官方客户端凭据与授权端点
const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
];

// UI 与 CDP Bridge 相关标识
const BRIDGE_NAME = '__agyAccountBridge';
const SETTINGS_BUTTON_SELECTOR = 'button[data-testid="settings-button"]';
const ACCOUNT_BTN_ID = 'agy-account-manager-btn';
const POPOVER_ID = 'agy-account-manager-popover';

module.exports = {
  HOME_DIR,
  APPDATA_DIR,
  LOCALAPPDATA_DIR,
  GEMINI_CONFIG_DIR,
  AGY_CONFIG_DIR,
  STORE_FILE,
  STANDALONE_TOKEN_FILE,
  OAUTH_CREDS_FILE,
  ACTIVE_ACCOUNT_FILE,
  QUOTA_CACHE_FILE,
  DAEMON_PID_FILE,
  DEVTOOLS_PORT_FILE,
  AGY_PROGRAM_DIR,
  LANGUAGE_SERVER_EXE,
  WIN_CRED_TARGET,
  WIN_CRED_USER,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GOOGLE_SCOPES,
  BRIDGE_NAME,
  SETTINGS_BUTTON_SELECTOR,
  ACCOUNT_BTN_ID,
  POPOVER_ID
};
