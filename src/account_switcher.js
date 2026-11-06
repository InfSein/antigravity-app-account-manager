/**
 * 账号切换核心模块
 * 负责执行账号切换、Token 预先刷新、更新系统级凭据以及通知 Antigravity 客户端重新载入
 */
const {
  getAccountTokens,
  setActiveAccount,
  upsertAccount
} = require('./account_store');
const { writeCurrentStoredToken } = require('./credential_manager');
const { refreshAccessToken } = require('./oauth_service');

/**
 * 检查 Token 是否需要刷新（过期或 5 分钟内将过期）
 */
function isTokenExpiring(tokens) {
  if (!tokens || !tokens.access_token) return true;
  if (!tokens.expiry) return false;
  try {
    const expiryTime = new Date(tokens.expiry).getTime();
    const now = Date.now();
    // 提前 5 分钟刷新
    return (expiryTime - now) < 300000;
  } catch {
    return false;
  }
}

/**
 * 切换到指定 Google 账号
 * @param {string} email 目标账号邮箱
 * @param {Function} [notifyClientFn] 可选的客户端通知回调（通过 CDP 向当前页面发送刷新信号）
 */
async function switchAccount(email, notifyClientFn) {
  if (!email) {
    throw new Error('未指定目标切换账号');
  }

  const tokens = getAccountTokens(email);
  if (!tokens) {
    throw new Error(`未找到账号 ${email} 的凭据信息`);
  }

  let validTokens = { ...tokens };

  // 1. 如果 Token 即将过期，使用 refresh_token 获取新 Token
  if (isTokenExpiring(validTokens) && validTokens.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(validTokens.refresh_token);
      validTokens = {
        ...validTokens,
        access_token: refreshed.access_token,
        expiry: refreshed.expiry,
        expires_in: refreshed.expires_in,
        token_type: refreshed.token_type
      };
      // 更新回本地存储
      upsertAccount(email, '', '', validTokens);
    } catch (err) {
      console.warn(`[AccountManager] 自动刷新 Token 失败: ${err.message}，尝试使用当前 Token 切换`);
    }
  }

  // 2. 将目标账号凭据写入 Windows 凭据管理器与本地 token 配置文件
  writeCurrentStoredToken({
    email,
    token: validTokens
  });

  // 3. 更新本地活跃账号状态
  setActiveAccount(email);

  // 4. 通知正在运行的 Antigravity 客户端刷新状态
  if (typeof notifyClientFn === 'function') {
    try {
      await notifyClientFn(email);
    } catch (e) {
      console.error('[AccountManager] 通知前端刷新失败:', e.message);
    }
  }

  return { success: true, email };
}

module.exports = {
  isTokenExpiring,
  switchAccount
};
