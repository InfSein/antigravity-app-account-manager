/**
 * Google OAuth 登录授权与 Token 刷新模块 (带深度调试日志与代理自适应)
 */
const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GOOGLE_SCOPES,
  AGY_CONFIG_DIR
} = require('./constants');

const DEBUG_LOG_FILE = path.join(AGY_CONFIG_DIR, 'oauth_debug.log');

function debugLog(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  try {
    if (!fs.existsSync(AGY_CONFIG_DIR)) {
      fs.mkdirSync(AGY_CONFIG_DIR, { recursive: true });
    }
    fs.appendFileSync(DEBUG_LOG_FILE, line, 'utf8');
  } catch {}
  console.log(...args);
}

/**
 * 获取本地系统代理配置
 */
function detectSystemProxy() {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (envProxy) return envProxy;

  if (process.platform === 'win32') {
    try {
      const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000
      });
      const match = out.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/);
      if (match && match[1]) {
        let p = match[1].trim();
        if (!p.startsWith('http://') && !p.startsWith('https://')) {
          p = 'http://' + p;
        }
        return p;
      }
    } catch {}
  }
  return null;
}

/**
 * 带有代理 CONNECT 隧道支持的 HTTPS 请求封装
 */
function requestHttps(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const proxy = detectSystemProxy();
    const port = u.port ? parseInt(u.port, 10) : 443;
    const bodyBuf = options.body ? Buffer.from(options.body, 'utf8') : null;

    const baseHeaders = {
      'Host': u.hostname,
      ...(options.headers || {})
    };
    if (bodyBuf && !baseHeaders['Content-Length']) {
      baseHeaders['Content-Length'] = bodyBuf.length;
    }

    debugLog('requestHttps start:', { targetUrl, proxy, method: options.method || 'GET', headers: baseHeaders });

    const doDirect = () => {
      debugLog('doDirect initiated for:', targetUrl);
      const req = https.request({
        hostname: u.hostname,
        port: port,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: baseHeaders
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          debugLog('doDirect response:', res.statusCode, data);
          resolve({ statusCode: res.statusCode, data });
        });
      });
      req.on('error', (err) => {
        debugLog('doDirect error:', err.message);
        reject(err);
      });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    };

    if (!proxy) {
      return doDirect();
    }

    try {
      const p = new URL(proxy);
      debugLog('Connecting to proxy:', p.host);
      const connectReq = http.request({
        host: p.hostname,
        port: p.port,
        method: 'CONNECT',
        path: `${u.hostname}:${port}`
      });

      connectReq.on('connect', (res, socket) => {
        debugLog('Proxy CONNECT status:', res.statusCode);
        if (res.statusCode !== 200) {
          socket.destroy();
          return doDirect();
        }
        const tlsSocket = tls.connect({
          socket: socket,
          servername: u.hostname
        }, () => {
          debugLog('TLS handshake done with servername:', u.hostname);
          const clientReq = https.request({
            hostname: u.hostname,
            port: port,
            path: u.pathname + u.search,
            method: options.method || 'GET',
            headers: baseHeaders,
            createConnection: () => tlsSocket
          }, (clientRes) => {
            let data = '';
            clientRes.on('data', chunk => data += chunk);
            clientRes.on('end', () => {
              debugLog('Proxy client response:', clientRes.statusCode, data);
              resolve({ statusCode: clientRes.statusCode, data });
            });
          });
          clientReq.on('error', (err) => {
            debugLog('clientReq error:', err.message);
            reject(err);
          });
          if (bodyBuf) clientReq.write(bodyBuf);
          clientReq.end();
        });
        tlsSocket.on('error', (err) => {
          debugLog('tlsSocket error:', err.message);
          reject(err);
        });
      });

      connectReq.on('error', (err) => {
        debugLog('connectReq error, falling back to direct:', err.message);
        doDirect();
      });

      connectReq.end();
    } catch (err) {
      debugLog('Proxy setup exception:', err.message);
      doDirect();
    }
  });
}

/**
 * 刷新 Access Token
 */
async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('缺少 refresh_token，无法刷新访问凭据');
  }

  const bodyParams = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await requestHttps(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: bodyParams.toString()
  });

  if (res.statusCode !== 200) {
    throw new Error(`Token 刷新失败 (HTTP ${res.statusCode}): ${res.data}`);
  }

  const parsed = JSON.parse(res.data);
  return {
    access_token: parsed.access_token,
    token_type: parsed.token_type || 'Bearer',
    expires_in: parsed.expires_in || 3599,
    expiry: new Date(Date.now() + (parsed.expires_in || 3599) * 1000).toISOString(),
    id_token: parsed.id_token || '',
    refresh_token: parsed.refresh_token || refreshToken // 若未返回新 refresh_token 则保持原有的
  };
}

/**
 * 根据授权 Code 换取 Tokens
 */
async function exchangeCodeForTokens(code, redirectUri, codeVerifier) {
  const bodyParams = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  debugLog('exchangeCodeForTokens params:', {
    client_id: GOOGLE_CLIENT_ID,
    code: code.slice(0, 10) + '...',
    code_verifier: codeVerifier.slice(0, 10) + '...',
    redirect_uri: redirectUri
  });

  const res = await requestHttps(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: bodyParams.toString()
  });

  if (res.statusCode !== 200) {
    throw new Error(`Code 换取 Token 失败 (HTTP ${res.statusCode}): ${res.data}`);
  }

  const parsed = JSON.parse(res.data);
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    token_type: parsed.token_type || 'Bearer',
    expires_in: parsed.expires_in || 3599,
    expiry: new Date(Date.now() + (parsed.expires_in || 3599) * 1000).toISOString(),
    id_token: parsed.id_token || ''
  };
}

/**
 * 获取 Google 账号用户信息
 */
async function fetchGoogleUserInfo(accessToken) {
  const res = await requestHttps(GOOGLE_USERINFO_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (res.statusCode !== 200) {
    throw new Error(`获取用户信息失败 (HTTP ${res.statusCode}): ${res.data}`);
  }

  return JSON.parse(res.data);
}

/**
 * 通过系统代理拉取远程头像并转为本地 Base64 Data URL，避免渲染进程无法直连 Google 头像服务器
 */
function fetchAvatarAsDataUrl(targetUrl) {
  return new Promise((resolve) => {
    if (!targetUrl || typeof targetUrl !== 'string') return resolve('');
    if (targetUrl.startsWith('data:')) return resolve(targetUrl);
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) return resolve('');

    try {
      const u = new URL(targetUrl);
      const proxy = detectSystemProxy();
      const port = u.port ? parseInt(u.port, 10) : 443;
      const headers = {
        'Host': u.hostname,
        'User-Agent': 'Mozilla/5.0'
      };

      const handleRes = (res) => {
        if (res.statusCode !== 200) return resolve('');
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const buf = Buffer.concat(chunks);
            if (buf.length === 0) return resolve('');
            const mime = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
            resolve(`data:${mime};base64,${buf.toString('base64')}`);
          } catch {
            resolve('');
          }
        });
      };

      const doDirect = () => {
        const req = https.request({
          hostname: u.hostname,
          port,
          path: u.pathname + u.search,
          method: 'GET',
          headers,
          timeout: 6000
        }, handleRes);
        req.on('error', () => resolve(''));
        req.on('timeout', () => { req.destroy(); resolve(''); });
        req.end();
      };

      if (!proxy) return doDirect();

      const p = new URL(proxy);
      const connectReq = http.request({
        host: p.hostname,
        port: p.port,
        method: 'CONNECT',
        path: `${u.hostname}:${port}`,
        timeout: 6000
      });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return doDirect();
        }
        const tlsSocket = tls.connect({
          socket,
          servername: u.hostname
        }, () => {
          const clientReq = https.request({
            hostname: u.hostname,
            port,
            path: u.pathname + u.search,
            method: 'GET',
            headers,
            createConnection: () => tlsSocket,
            timeout: 6000
          }, handleRes);
          clientReq.on('error', () => resolve(''));
          clientReq.on('timeout', () => { clientReq.destroy(); resolve(''); });
          clientReq.end();
        });
        tlsSocket.on('error', () => resolve(''));
      });

      connectReq.on('error', () => doDirect());
      connectReq.on('timeout', () => { connectReq.destroy(); doDirect(); });
      connectReq.end();
    } catch {
      resolve('');
    }
  });
}

/**
 * 打开系统默认浏览器
 */
function openInBrowser(url) {
  debugLog('openInBrowser:', url);
  const startCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(startCmd, (err) => {
    if (err) debugLog('openInBrowser error:', err.message);
  });
}

/**
 * 生成授权成功后展示的友好页面 HTML（支持中英文）
 */
function getSuccessHtml(email, lang = 'en') {
  const isZh = lang === 'zh';
  const title = isZh ? 'Antigravity 账号授权成功' : 'Antigravity Account Authorized';
  const heading = isZh ? '授权成功' : 'Authorization Successful';
  const sub = isZh ? 'Google 账号已成功授权：' : 'Google account authorized:';
  const desc = isZh
    ? 'Antigravity 已自动保存该账号并完成切换。<br>您可以关闭此浏览器标签页并返回客户端。'
    : 'Antigravity has saved and switched to this account.<br>You may now close this tab and return to the app.';
  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      background: #238636;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 32px;
    }
    h2 { margin: 0 0 12px; color: #58a6ff; }
    p { margin: 8px 0; color: #8b949e; line-height: 1.6; }
    .email { color: #f0f6fc; font-weight: 600; background: #21262d; padding: 4px 12px; border-radius: 6px; display: inline-block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h2>${heading}</h2>
    <p>${sub}</p>
    <p><span class="email">${email}</span></p>
    <p style="margin-top: 24px;">${desc}</p>
  </div>
</body>
</html>`;
}

/**
 * 启动完整的 Google OAuth 网页授权流程
 */
function startOAuthFlow(lang = 'en') {
  return new Promise((resolve, reject) => {
    debugLog('startOAuthFlow called');
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    let settled = false;
    let timeoutId = null;

    const server = http.createServer(async (req, res) => {
      debugLog('OAuth callback server received request:', req.url);
      try {
        const reqUrl = new URL(req.url, 'http://127.0.0.1');
        if (!reqUrl.pathname.startsWith('/callback')) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');

        if (!code || returnedState !== state) {
          debugLog('Invalid callback params:', { code: !!code, returnedState, state });
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(lang === 'zh' ? '授权回调参数无效或已过期，请重试。' : 'Invalid or expired authorization callback parameters. Please try again.');
          cleanup(new Error(lang === 'zh' ? '回调状态验证失败' : 'Callback state validation failed'));
          return;
        }

        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        debugLog('Exchanging code for tokens...');
        const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);
        debugLog('Tokens obtained successfully, fetching user info...');
        const userInfo = await fetchGoogleUserInfo(tokens.access_token);
        debugLog('User info obtained:', userInfo.email, userInfo.name);

        if (userInfo.picture && userInfo.picture.startsWith('http')) {
          const avatarDataUrl = await fetchAvatarAsDataUrl(userInfo.picture);
          if (avatarDataUrl) {
            userInfo.picture = avatarDataUrl;
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getSuccessHtml(userInfo.email, lang));

        cleanup(null, { tokens, userInfo });
      } catch (err) {
        debugLog('startOAuthFlow callback processing error:', err.stack || err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('登录授权处理异常: ' + err.message);
        cleanup(err);
      }
    });

    function cleanup(err, result) {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        server.close();
      } catch {}

      if (err) reject(err);
      else resolve(result);
    }

    timeoutId = setTimeout(() => {
      cleanup(new Error('Google 授权超时，请在浏览器中重新尝试'));
    }, 180000);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr.port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      debugLog('OAuth loopback server listening on port:', port);

      const authUrlParams = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'select_account consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const fullAuthUrl = `${GOOGLE_AUTH_URL}?${authUrlParams.toString()}`;
      openInBrowser(fullAuthUrl);
    });

    server.on('error', (err) => {
      debugLog('OAuth server error:', err.message);
      cleanup(err);
    });
  });
}

module.exports = {
  detectSystemProxy,
  refreshAccessToken,
  fetchGoogleUserInfo,
  fetchAvatarAsDataUrl,
  startOAuthFlow
};
