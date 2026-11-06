/**
 * CDP 远程注入与双向通信管理模块 (带详细执行日志)
 */
const fs = require('fs');
const http = require('http');
const { DEVTOOLS_PORT_FILE, BRIDGE_NAME } = require('./constants');
const { initAccountStore, getPublicAccounts, removeAccount, upsertAccount } = require('./account_store');
const { switchAccount } = require('./account_switcher');
const { startOAuthFlow } = require('./oauth_service');
const { getClientInjectionScript } = require('./ui_script');

const LOG_FILE = 'C:\\Users\\InfSein\\.gemini\\antigravity\\brain\\f2cafeb6-7448-4b97-8a28-e9b687b7ba45\\scratch\\daemon_live.log';
function log(msg) {
  const str = `[${new Date().toISOString()}] [CDP] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, str, 'utf8');
  } catch {}
  console.log('[CDP]', msg);
}

class CdpInjector {
  constructor() {
    this.ws = null;
    this.msgId = 0;
    this.pendingCdp = new Map();
    this.activePort = null;
    this.reconnectTimer = null;
    this.isConnecting = false;
  }

  readDevToolsPort() {
    if (!fs.existsSync(DEVTOOLS_PORT_FILE)) return null;
    try {
      const content = fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf8').trim();
      const lines = content.split(/\r?\n/);
      if (lines.length > 0) {
        const port = parseInt(lines[0].trim(), 10);
        return Number.isInteger(port) && port > 0 ? port : null;
      }
    } catch {}
    return null;
  }

  fetchMainTarget(port) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const targets = JSON.parse(raw);
            const mainPage = targets.find(t => t.type === 'page' && (t.url.includes('127.0.0.1') || t.url.includes('antigravity')));
            resolve(mainPage || targets.find(t => t.type === 'page') || null);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  sendCdpCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket 未就绪'));
      }
      const id = ++this.msgId;
      this.pendingCdp.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pendingCdp.delete(id);
        reject(err);
      }
      setTimeout(() => {
        if (this.pendingCdp.has(id)) {
          this.pendingCdp.delete(id);
          reject(new Error(`CDP 命令 ${method} 超时`));
        }
      }, 10000);
    });
  }

  async evaluate(expression) {
    return this.sendCdpCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
  }

  async handleBridgeCall(payloadStr) {
    log(`收到前端 Bridge 请求: ${payloadStr}`);
    let req;
    try {
      req = JSON.parse(payloadStr);
    } catch (e) {
      log(`解析前端 Bridge 请求失败: ${e.message}`);
      return;
    }

    const { id, action, payload } = req;
    let result = null;
    let error = null;

    try {
      switch (action) {
        case 'get_accounts': {
          log('处理 get_accounts 操作');
          initAccountStore();
          result = getPublicAccounts();
          break;
        }
        case 'switch_account': {
          log(`处理 switch_account: ${payload && payload.email}`);
          result = await switchAccount(payload.email, async () => {
            await this.evaluate(`
              try {
                const bc = new BroadcastChannel("jetski_ls_auth_channel");
                bc.postMessage({ type: "SIGN_IN", timestamp: Date.now() });
              } catch(e) {}
            `);
          });
          break;
        }
        case 'add_account': {
          log('处理 add_account: 开始启动 OAuth 流程...');
          const authRes = await startOAuthFlow();
          const { tokens, userInfo } = authRes;
          log(`OAuth 流程成功，获得用户信息: ${userInfo.email}`);
          upsertAccount(userInfo.email, userInfo.name || userInfo.email.split('@')[0], userInfo.picture || '', tokens);
          await switchAccount(userInfo.email);
          result = { email: userInfo.email, name: userInfo.name, picture: userInfo.picture };
          break;
        }
        case 'remove_account': {
          log(`处理 remove_account: ${payload && payload.email}`);
          result = { success: removeAccount(payload.email) };
          break;
        }
        default:
          throw new Error(`未知的操作类型: ${action}`);
      }
    } catch (err) {
      log(`Bridge 操作 ${action} 异常: ${err.stack || err.message}`);
      error = err.message || String(err);
    }

    const callbackPayload = JSON.stringify(error ? { error } : result);
    try {
      await this.evaluate(`window.__agyAccountCallback(${id}, ${callbackPayload});`);
      log(`回调 ${id} 已回传前端`);
    } catch (cbErr) {
      log(`发送回调响应失败: ${cbErr.message}`);
    }
  }

  connectAndInject() {
    if (this.isConnecting) return Promise.resolve();
    this.isConnecting = true;

    return new Promise(async (resolve, reject) => {
      try {
        const port = this.readDevToolsPort();
        if (!port) {
          this.isConnecting = false;
          this.scheduleReconnect(3000);
          return resolve();
        }

        const target = await this.fetchMainTarget(port);
        if (!target || !target.webSocketDebuggerUrl) {
          this.isConnecting = false;
          this.scheduleReconnect(3000);
          return resolve();
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.activePort === port) {
          this.isConnecting = false;
          return resolve();
        }

        this.closeSocket();

        log(`连接到 CDP WebSocket: ${target.webSocketDebuggerUrl}`);
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        this.ws = ws;
        this.activePort = port;

        let resolved = false;
        const markResolved = () => {
          if (!resolved) {
            resolved = true;
            this.isConnecting = false;
            resolve();
          }
        };

        ws.onopen = async () => {
          try {
            log('CDP 连接建立成功，注册 Binding 与注入脚本...');
            await this.sendCdpCommand('Runtime.enable');
            await this.sendCdpCommand('Page.enable');
            await this.sendCdpCommand('Runtime.addBinding', { name: BRIDGE_NAME });

            const injectionCode = getClientInjectionScript();
            await this.sendCdpCommand('Page.addScriptToEvaluateOnNewDocument', {
              source: injectionCode
            });
            await this.evaluate(injectionCode);
            log('注入脚本 evaluate 完成');
            markResolved();
          } catch (setupErr) {
            log(`设置注入脚本失败: ${setupErr.message}`);
            markResolved();
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.id && this.pendingCdp.has(msg.id)) {
              const { resolve: cdpResolve, reject: cdpReject } = this.pendingCdp.get(msg.id);
              this.pendingCdp.delete(msg.id);
              if (msg.error) cdpReject(new Error(msg.error.message || 'CDP Error'));
              else cdpResolve(msg.result);
            }

            if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === BRIDGE_NAME) {
              this.handleBridgeCall(msg.params.payload);
            }

            if (msg.method === 'Page.frameNavigated' || msg.method === 'Page.loadEventFired') {
              this.sendCdpCommand('Runtime.addBinding', { name: BRIDGE_NAME }).catch(() => {});
              this.evaluate(getClientInjectionScript()).catch(() => {});
            }
          } catch (parseErr) {
            log(`消息解析异常: ${parseErr.message}`);
          }
        };

        ws.onclose = () => {
          log('CDP 连接关闭');
          this.closeSocket();
          this.scheduleReconnect(800);
          markResolved();
        };

        ws.onerror = (err) => {
          log(`CDP 连接错误: ${err && err.message}`);
          this.closeSocket();
          this.scheduleReconnect(800);
          markResolved();
        };

      } catch (err) {
        log(`connectAndInject 异常: ${err.message}`);
        this.isConnecting = false;
        this.scheduleReconnect(800);
        resolve();
      }
    });
  }

  scheduleReconnect(ms) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connectAndInject();
      }
    }, ms);
  }

  closeSocket() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  start() {
    initAccountStore();
    this.connectAndInject();
    setInterval(() => {
      if (!this.isConnecting && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.connectAndInject();
      }
    }, 5000);
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.closeSocket();
  }
}

module.exports = {
  CdpInjector
};
