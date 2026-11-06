/**
 * 本地多账号持久化存储模块
 * 负责管理所有保存的 Google 账号列表、激活账号以及初次加载时的自动侦测与保存
 */
const fs = require('fs');
const path = require('path');
const {
  STORE_FILE,
  AGY_CONFIG_DIR,
  QUOTA_CACHE_FILE
} = require('./constants');
const {
  readCurrentStoredToken,
  extractProfileFromIdToken
} = require('./credential_manager');
const {
  fetchAvatarAsDataUrl,
  fetchGoogleUserInfo
} = require('./oauth_service');

/**
 * 确保存储目录存在
 */
function ensureDirExists() {
  if (!fs.existsSync(AGY_CONFIG_DIR)) {
    fs.mkdirSync(AGY_CONFIG_DIR, { recursive: true });
  }
}

/**
 * 读取完整的本地账号存储数据
 */
function loadRawStore() {
  ensureDirExists();
  if (!fs.existsSync(STORE_FILE)) {
    return { activeEmail: '', accounts: [] };
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8').trim();
    if (!raw) return { activeEmail: '', accounts: [] };
    const parsed = JSON.parse(raw);
    return {
      activeEmail: parsed.activeEmail || '',
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : []
    };
  } catch (err) {
    console.error('读取账号存储文件失败:', err.message);
    return { activeEmail: '', accounts: [] };
  }
}

/**
 * 安全保存本地账号数据
 */
function saveStore(data) {
  ensureDirExists();
  const jsonStr = JSON.stringify(data, null, 2);
  const tempFile = `${STORE_FILE}.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tempFile, jsonStr, { encoding: 'utf8', mode: 0o600 });
    // Windows 下 rename 覆盖已有文件可能抛错，先删除再 rename 或直接写入
    try {
      if (fs.existsSync(STORE_FILE)) {
        fs.unlinkSync(STORE_FILE);
      }
      fs.renameSync(tempFile, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, jsonStr, { encoding: 'utf8', mode: 0o600 });
      try { fs.unlinkSync(tempFile); } catch {}
    }
  } catch (err) {
    fs.writeFileSync(STORE_FILE, jsonStr, { encoding: 'utf8', mode: 0o600 });
  }
}

/**
 * 尝试从本地 quota-cache.json 中读取历史账号详情辅助初始化
 */
function readQuotaCacheAccounts() {
  if (!fs.existsSync(QUOTA_CACHE_FILE)) return [];
  try {
    const content = fs.readFileSync(QUOTA_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      const results = [];
      for (const [key, val] of Object.entries(parsed)) {
        if (key.includes('@') && val && typeof val === 'object') {
          results.push({
            email: key,
            name: val.name || val.userName || key.split('@')[0],
            planName: val.planName || val.tier || 'Free'
          });
        }
      }
      return results;
    }
  } catch {}
  return [];
}

/**
 * 插件初次加载时初始化账号存储
 * 需求：插件初次加载时就应当读取当前登录的账号信息并保存
 */
function initAccountStore() {
  const store = loadRawStore();
  const currentToken = readCurrentStoredToken();

  let modified = false;

  // 1. 如果系统当前有登录的账号，确保它保存在 store 中
  const currentEmail = (currentToken && (currentToken.id_token_email || currentToken.email || '')) ? (currentToken.id_token_email || currentToken.email).trim() : '';

  if (currentEmail) {
    const existingIndex = store.accounts.findIndex(a => a.email.toLowerCase() === currentEmail.toLowerCase());

    const cacheAccounts = readQuotaCacheAccounts();
    const matchedCache = cacheAccounts.find(c => c.email.toLowerCase() === currentEmail.toLowerCase());

    const innerTokens = (currentToken.token) || currentToken;
    const jwtProfile = extractProfileFromIdToken(innerTokens.id_token);
    const existingPic = existingIndex >= 0 ? (store.accounts[existingIndex].picture || '') : '';
    const existingName = existingIndex >= 0 ? (store.accounts[existingIndex].name || '') : '';

    const accountObj = {
      email: currentEmail,
      name: (matchedCache && matchedCache.name) || jwtProfile.name || existingName || currentEmail.split('@')[0],
      picture: existingPic.startsWith('data:') ? existingPic : (jwtProfile.picture || existingPic || ''),
      planName: (matchedCache && matchedCache.planName) || (existingIndex >= 0 ? store.accounts[existingIndex].planName : 'Pro'),
      addedAt: existingIndex >= 0 ? store.accounts[existingIndex].addedAt : new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      tokens: {
        access_token: innerTokens.access_token || '',
        refresh_token: innerTokens.refresh_token || '',
        expiry: innerTokens.expiry || '',
        expires_in: innerTokens.expires_in || 3599,
        token_type: innerTokens.token_type || 'Bearer',
        id_token: innerTokens.id_token || ''
      }
    };

    if (existingIndex >= 0) {
      // 保持原有有效 refresh_token（若新 token 没带 refresh_token）
      if (!accountObj.tokens.refresh_token && store.accounts[existingIndex].tokens && store.accounts[existingIndex].tokens.refresh_token) {
        accountObj.tokens.refresh_token = store.accounts[existingIndex].tokens.refresh_token;
      }
      store.accounts[existingIndex] = {
        ...store.accounts[existingIndex],
        name: accountObj.name || store.accounts[existingIndex].name,
        picture: accountObj.picture || store.accounts[existingIndex].picture,
        lastActiveAt: accountObj.lastActiveAt,
        tokens: accountObj.tokens
      };
      modified = true;
    } else {
      // 首次添加当前账号
      store.accounts.push(accountObj);
      modified = true;
    }

    if (!store.activeEmail || store.activeEmail.toLowerCase() !== currentEmail.toLowerCase()) {
      store.activeEmail = currentEmail;
      modified = true;
    }
  }

  // 2. 如果没有任何 activeEmail 但有 accounts，取第一个为 activeEmail
  if (!store.activeEmail && store.accounts.length > 0) {
    store.activeEmail = store.accounts[0].email;
    modified = true;
  }

  if (modified) {
    saveStore(store);
  }

  return store;
}

/**
 * 获取可安全返回给前端的账号列表
 */
function getPublicAccounts() {
  const store = loadRawStore();
  return {
    activeEmail: store.activeEmail,
    accounts: store.accounts.map(acc => ({
      email: acc.email,
      name: acc.name || acc.email.split('@')[0],
      picture: acc.picture || '',
      planName: acc.planName || '',
      addedAt: acc.addedAt,
      lastActiveAt: acc.lastActiveAt,
      hasValidToken: !!(acc.tokens && (acc.tokens.refresh_token || acc.tokens.access_token))
    }))
  };
}

/**
 * 插入或更新账号
 */
function upsertAccount(email, name, picture, tokens, planName = '') {
  if (!email) return false;
  const store = loadRawStore();
  const normalizedEmail = email.trim();
  const idx = store.accounts.findIndex(a => a.email.toLowerCase() === normalizedEmail.toLowerCase());

  const now = new Date().toISOString();
  if (idx >= 0) {
    const existing = store.accounts[idx];
    const mergedTokens = {
      ...(existing.tokens || {}),
      ...(tokens || {})
    };
    // 如果新 tokens 缺少 refresh_token，必须继承现有的
    if (!tokens || !tokens.refresh_token) {
      mergedTokens.refresh_token = (existing.tokens && existing.tokens.refresh_token) || '';
    }

    store.accounts[idx] = {
      ...existing,
      name: name || existing.name,
      picture: picture || existing.picture,
      planName: planName || existing.planName,
      tokens: mergedTokens,
      lastActiveAt: now
    };
  } else {
    store.accounts.push({
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      picture: picture || '',
      planName: planName || 'Pro',
      addedAt: now,
      lastActiveAt: now,
      tokens: tokens || {}
    });
  }

  store.activeEmail = normalizedEmail;
  saveStore(store);
  return true;
}

/**
 * 设置当前活跃账号
 */
function setActiveAccount(email) {
  const store = loadRawStore();
  const normalized = (email || '').toLowerCase();
  const found = store.accounts.find(a => a.email.toLowerCase() === normalized);
  if (!found) return false;

  store.activeEmail = found.email;
  found.lastActiveAt = new Date().toISOString();
  saveStore(store);
  return true;
}

/**
 * 获取指定账号的完整凭据 tokens
 */
function getAccountTokens(email) {
  const store = loadRawStore();
  const normalized = (email || '').toLowerCase();
  const found = store.accounts.find(a => a.email.toLowerCase() === normalized);
  return found ? found.tokens : null;
}

/**
 * 删除账号
 */
function removeAccount(email) {
  const store = loadRawStore();
  const normalized = (email || '').toLowerCase();
  const originalLen = store.accounts.length;
  store.accounts = store.accounts.filter(a => a.email.toLowerCase() !== normalized);

  if (store.accounts.length === originalLen) {
    return false;
  }

  // 如果删除的是当前激活账号，重新指派激活账号
  let nextEmailToSwitch = null;
  if (store.activeEmail.toLowerCase() === normalized) {
    store.activeEmail = store.accounts.length > 0 ? store.accounts[0].email : '';
    nextEmailToSwitch = store.activeEmail;
  }

  saveStore(store);
  return { success: true, nextEmailToSwitch };
}

/**
 * 检查并补全所有已保存账号的本地 Base64 头像数据
 * 若账号只有远程 http/https 链接或尚未提取 id_token 头像，则通过代理下载转为 data:URI 持久化
 */
async function ensureAccountsAvatars() {
  const store = loadRawStore();
  let modified = false;

  for (const acc of store.accounts) {
    if (acc.picture && acc.picture.startsWith('data:')) {
      continue;
    }

    let remotePicUrl = (acc.picture && acc.picture.startsWith('http')) ? acc.picture : '';
    if (!remotePicUrl && acc.tokens && acc.tokens.id_token) {
      const profile = extractProfileFromIdToken(acc.tokens.id_token);
      if (profile.picture) remotePicUrl = profile.picture;
      if (!acc.name && profile.name) {
        acc.name = profile.name;
        modified = true;
      }
    }

    if (!remotePicUrl && acc.tokens && acc.tokens.access_token) {
      try {
        const info = await fetchGoogleUserInfo(acc.tokens.access_token);
        if (info && info.picture) remotePicUrl = info.picture;
        if (info && info.name && (!acc.name || acc.name === acc.email.split('@')[0])) {
          acc.name = info.name;
          modified = true;
        }
      } catch {}
    }

    if (remotePicUrl) {
      const dataUrl = await fetchAvatarAsDataUrl(remotePicUrl);
      if (dataUrl) {
        acc.picture = dataUrl;
        modified = true;
      }
    }
  }

  if (modified) {
    saveStore(store);
  }
  return modified;
}

module.exports = {
  loadRawStore,
  saveStore,
  initAccountStore,
  getPublicAccounts,
  upsertAccount,
  setActiveAccount,
  getAccountTokens,
  removeAccount,
  ensureAccountsAvatars
};
