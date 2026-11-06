/**
 * 系统凭据管理模块
 * 负责跨平台读写 Antigravity 运行所依赖的原生凭据：
 * 1. Windows: Windows 凭据管理器 (Target: gemini:antigravity, Type: Generic)
 * 2. 文件系统备份: ~/.gemini/jetski-standalone-oauth-token 与 ~/.gemini/oauth_creds.json 等
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  STANDALONE_TOKEN_FILE,
  OAUTH_CREDS_FILE,
  ACTIVE_ACCOUNT_FILE,
  APP_STORAGE_FILE,
  WIN_CRED_TARGET,
  WIN_CRED_USER
} = require('./constants');

const WINCRED_PS1 = path.join(__dirname, 'wincred.ps1');

/**
 * 生成全新的随机 writer_id
 * language_server 的 syncWithStoredToken 依赖 writer_id 的变更来感知外部账号切换
 */
function generateWriterId() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * 从 JWT 格式的 id_token 中解析出用户信息 (email, name, picture)
 */
function extractProfileFromIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return { email: '', name: '', picture: '' };
  try {
    const parts = idToken.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return {
        email: payload.email || '',
        name: payload.name || payload.given_name || '',
        picture: payload.picture || ''
      };
    }
  } catch {}
  return { email: '', name: '', picture: '' };
}

/**
 * 从 JWT 格式的 id_token 中解析出 email
 */
function extractEmailFromIdToken(idToken) {
  return extractProfileFromIdToken(idToken).email;
}

/**
 * 在 Windows 上执行 WinCred 读取
 */
function readWinCred(target) {
  if (process.platform !== 'win32') return null;
  try {
    const res = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', WINCRED_PS1,
      '-Action', 'read',
      '-Target', target
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if (res.status === 0 && res.stdout) {
      const trimmed = res.stdout.trim();
      if (trimmed) {
        return JSON.parse(trimmed);
      }
    }
  } catch (err) {
    // 读取失败时静默回退
  }
  return null;
}

/**
 * 在 Windows 上写入 WinCred
 */
function writeWinCred(target, userName, jsonPayload) {
  if (process.platform !== 'win32') return false;
  try {
    const str = typeof jsonPayload === 'string' ? jsonPayload : JSON.stringify(jsonPayload);
    const res = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', WINCRED_PS1,
      '-Action', 'write',
      '-Target', target,
      '-UserName', userName
    ], {
      input: str,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if (res.status === 0 && res.stdout && res.stdout.includes('True')) {
      return true;
    }
    if (res.stderr) {
      console.error('写入 Windows 凭据管理器警告:', res.stderr.trim());
    }
    return false;
  } catch (err) {
    console.error('写入 Windows 凭据管理器失败:', err.message);
    return false;
  }
}

/**
 * 读取当前系统生效的 Antigravity 凭据
 * 优先级：Windows Credential Manager -> jetski-standalone-oauth-token -> oauth_creds.json
 */
function readCurrentStoredToken() {
  // 1. 尝试 Windows Credential Manager
  const winCredToken = readWinCred(WIN_CRED_TARGET);
  if (winCredToken && winCredToken.token && winCredToken.token.access_token) {
    if (!winCredToken.id_token_email && winCredToken.token.id_token) {
      winCredToken.id_token_email = extractEmailFromIdToken(winCredToken.token.id_token);
    }
    return winCredToken;
  }

  // 2. 尝试 jetski-standalone-oauth-token
  if (fs.existsSync(STANDALONE_TOKEN_FILE)) {
    try {
      const content = fs.readFileSync(STANDALONE_TOKEN_FILE, 'utf8').trim();
      const parsed = JSON.parse(content);
      if (parsed && parsed.token && parsed.token.access_token) {
        if (!parsed.id_token_email && parsed.token.id_token) {
          parsed.id_token_email = extractEmailFromIdToken(parsed.token.id_token);
        }
        return parsed;
      }
    } catch {}
  }

  // 3. 尝试 oauth_creds.json
  if (fs.existsSync(OAUTH_CREDS_FILE)) {
    try {
      const content = fs.readFileSync(OAUTH_CREDS_FILE, 'utf8').trim();
      const parsed = JSON.parse(content);
      if (parsed && (parsed.access_token || (parsed.token && parsed.token.access_token))) {
        const idToken = (parsed.token && parsed.token.id_token) || parsed.id_token || '';
        let email = parsed.id_token_email || parsed.email || '';
        if (!email && idToken) {
          email = extractEmailFromIdToken(idToken);
        }
        return {
          writer_id: generateWriterId(),
          auth_method: 'consumer',
          token: parsed.token || {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            token_type: parsed.token_type || 'Bearer',
            expires_in: parsed.expires_in || 3599,
            expiry: parsed.expiry || (parsed.expiry_date ? new Date(parsed.expiry_date).toISOString() : new Date(Date.now() + 3600000).toISOString()),
            id_token: idToken
          },
          id_token_email: email
        };
      }
    } catch {}
  }

  return null;
}

/**
 * 将新的凭据写入系统凭据管理器及关联备份文件
 * @param {Object} tokenObj 包含 access_token, refresh_token, expiry, email 等字段
 */
function writeCurrentStoredToken(tokenObj) {
  const email = tokenObj.id_token_email || tokenObj.email || '';
  const writerId = tokenObj.writer_id || generateWriterId();
  const innerToken = tokenObj.token || tokenObj;

  const storedToken = {
    writer_id: writerId,
    auth_method: 'consumer',
    token: {
      access_token: innerToken.access_token || '',
      token_type: innerToken.token_type || 'Bearer',
      refresh_token: innerToken.refresh_token || '',
      expiry: innerToken.expiry || '',
      expires_in: innerToken.expires_in || 3599,
      id_token: innerToken.id_token || ''
    },
    id_token_email: email
  };

  const jsonStr = JSON.stringify(storedToken, null, 2);

  // 1. 写入 Windows 凭据管理器
  if (process.platform === 'win32') {
    writeWinCred(WIN_CRED_TARGET, WIN_CRED_USER, jsonStr);
  }

  // 2. 写入 ~/.gemini/jetski-standalone-oauth-token
  try {
    const parentDir = path.dirname(STANDALONE_TOKEN_FILE);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(STANDALONE_TOKEN_FILE, jsonStr, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.error('写入 standalone token 文件失败:', e.message);
  }

  // 3. 规范化写入 ~/.gemini/oauth_creds.json (保持标准 Google 扁平 JSON 格式)
  try {
    const expiryDate = innerToken.expiry
      ? new Date(innerToken.expiry).getTime()
      : (Date.now() + (innerToken.expires_in || 3600) * 1000);
    const standardOAuthCreds = {
      access_token: innerToken.access_token || '',
      refresh_token: innerToken.refresh_token || '',
      scope: innerToken.scope || 'openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
      token_type: innerToken.token_type || 'Bearer',
      id_token: innerToken.id_token || '',
      expiry_date: expiryDate
    };
    fs.writeFileSync(OAUTH_CREDS_FILE, JSON.stringify(standardOAuthCreds, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.error('写入 oauth_creds.json 文件失败:', e.message);
  }

  // 4. 写入 ~/.gemini/antigravity/active-account.json
  try {
    const activeDir = path.dirname(ACTIVE_ACCOUNT_FILE);
    if (!fs.existsSync(activeDir)) {
      fs.mkdirSync(activeDir, { recursive: true });
    }
    fs.writeFileSync(ACTIVE_ACCOUNT_FILE, JSON.stringify({
      email,
      lastSwitchedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch {}

  // 5. 同步更新 Antigravity 本地 app_storage.json 中的登录账号记录，避免每次切换账号弹出“安全提示与数据使用说明”
  if (email && fs.existsSync(APP_STORAGE_FILE)) {
    try {
      const rawStorage = fs.readFileSync(APP_STORAGE_FILE, 'utf8');
      const parsedStorage = JSON.parse(rawStorage);
      if (parsedStorage && typeof parsedStorage === 'object') {
        parsedStorage['agy.onboarding.lastLoginUsername'] = email;
        parsedStorage['agy.onboarding.lastLoginIsGcpTos'] = 'false';
        parsedStorage['agy.onboarding.welcomeModalSeen'] = 'true';
        fs.writeFileSync(APP_STORAGE_FILE, JSON.stringify(parsedStorage, null, 2), 'utf8');
      }
    } catch {}
  }

  return storedToken;
}

module.exports = {
  generateWriterId,
  extractProfileFromIdToken,
  extractEmailFromIdToken,
  readWinCred,
  writeWinCred,
  readCurrentStoredToken,
  writeCurrentStoredToken
};
