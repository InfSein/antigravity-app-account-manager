/**
 * Antigravity 账号管理插件一键卸载脚本
 * 1. 终止后台常驻服务
 * 2. 从当前运行的界面中移除注入的 DOM 元素
 * 3. 清理插件目录 ~/.gemini/config/plugins/antigravity-account-manager
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { CdpInjector } = require('./src/cdp_injector');
const { ACCOUNT_BTN_ID, POPOVER_ID, DAEMON_PID_FILE } = require('./src/constants');

const TARGET_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'antigravity-account-manager');

async function uninstall() {
  console.log('=== 开始卸载 Antigravity 账号管理插件 ===');

  // 1. 停止常驻后台服务
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, 'SIGTERM');
      }
      fs.unlinkSync(DAEMON_PID_FILE);
    } catch {}
  }
  if (process.platform === 'win32') {
    try {
      execSync('powershell "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*account-manager*main.mjs*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', {
        stdio: 'ignore'
      });
    } catch {}
  }
  console.log('✓ 已停止后台常驻服务');

  // 2. 尝试从界面移除 DOM
  try {
    const injector = new CdpInjector();
    await injector.connectAndInject();
    await injector.evaluate(`
      try {
        if (window.__agyAccountManager && typeof window.__agyAccountManager.cleanup === 'function') {
          window.__agyAccountManager.cleanup();
        }
        ['${ACCOUNT_BTN_ID}', '${POPOVER_ID}', 'agy-account-manager-style', 'agy-account-confirm-modal', 'agy-account-switch-mask', 'agy-account-toast'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.remove();
        });
        window.__agyAccountManager = null;
      } catch(e) {}
    `);
    injector.stop();
    console.log('✓ 已从当前 Antigravity 窗口中移除账号按钮');
  } catch {}

  // 3. 清理插件安装目录
  if (fs.existsSync(TARGET_DIR)) {
    try {
      fs.rmSync(TARGET_DIR, { recursive: true, force: true });
      console.log('✓ 插件目录已成功移除');
    } catch (e) {
      console.error('移除插件目录失败:', e.message);
    }
  }

  console.log('=== 卸载完成 ===');
  process.exit(0);
}

uninstall();
