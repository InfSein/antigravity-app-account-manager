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
const { readCurrentStoredToken } = require('./credential_manager');

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
    fs.renameSync(tempFile, STORE_FILE);
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
  if (currentToken && currentToken.id_token_email) {
    const currentEmail = currentToken.id_token_email.trim();
    const existingIndex = store.accounts.findIndex(a => a.email.toLowerCase() === currentEmail.toLowerCase());

    const cacheAccounts = readQuotaCacheAccounts();
    const matchedCache = cacheAccounts.find(c => c.email.toLowerCase() === currentEmail.toLowerCase());

    const accountObj = {
      email: currentEmail,
      name: (matchedCache && matchedCache.name) || currentEmail.split('@')[0],
      picture: '',
      planName: (matchedCache && matchedCache.planName) || 'Pro',
      addedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      tokens: {
        access_token: currentToken.token.access_token || '',
        refresh_token: currentToken.token.refresh_token || '',
        expiry: currentToken.token.expiry || '',
        expires_in: currentToken.token.expires_in || 3599,
        token_type: currentToken.token.token_type || 'Bearer'
      }
    };

    if (existingIndex >= 0) {
      // 更新现有账号的 token
      store.accounts[existingIndex].tokens = accountObj.tokens;
      store.accounts[existingIndex].lastActiveAt = new Date().toISOString();
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
      hasValidToken: !!(acc.tokens && acc.tokens.refresh_token)
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
    store.accounts[idx] = {
      ...existing,
      name: name || existing.name,
      picture: picture || existing.picture,
      planName: planName || existing.planName,
      tokens: tokens || existing.tokens,
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
  if (store.activeEmail.toLowerCase() === normalized) {
    store.activeEmail = store.accounts.length > 0 ? store.accounts[0].email : '';
  }

  saveStore(store);
  return true;
}

module.exports = {
  loadRawStore,
  saveStore,
  initAccountStore,
  getPublicAccounts,
  upsertAccount,
  setActiveAccount,
  getAccountTokens,
  removeAccount
};
