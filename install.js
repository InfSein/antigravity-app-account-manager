/**
 * Antigravity 账号管理插件一键安装与热注入脚本
 * 1. 同步文件到用户插件目录 ~/.gemini/config/plugins/antigravity-account-manager
 * 2. 终止任何可能运行旧代码的残留后台进程
 * 3. 自动导入当前登录账号并对运行中的 Antigravity 窗口执行热注入
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { initAccountStore, getPublicAccounts } = require('./src/account_store');
const { CdpInjector } = require('./src/cdp_injector');
const { DAEMON_PID_FILE } = require('./src/constants');

const SOURCE_DIR = __dirname;
const TARGET_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'antigravity-account-manager');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      if (item === 'node_modules' || item === '.git') continue;
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function stopOldDaemon() {
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const pidStr = fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
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
}

async function install() {
  console.log('=== 开始安装 Antigravity 账号管理插件 ===');
  console.log('目标目录:', TARGET_DIR);

  // 1. 终止旧进程
  stopOldDaemon();

  // 2. 同步文件到插件目录
  copyRecursive(SOURCE_DIR, TARGET_DIR);
  console.log('✓ 插件文件已成功同步到插件目录');

  // 3. 初始化读取并保存当前登录账号
  console.log('正在读取当前已登录 Google 账号...');
  initAccountStore();
  const accountsInfo = getPublicAccounts();
  console.log(`✓ 账号读取完成，当前已保存账号数量: ${accountsInfo.accounts.length}`);
  if (accountsInfo.activeEmail) {
    console.log(`✓ 当前活跃账号: ${accountsInfo.activeEmail}`);
  }

  // 4. 热注入到当前运行中的 Antigravity 桌面端
  console.log('正在检测运行中的 Antigravity 客户端并进行即时注入...');
  const injector = new CdpInjector();
  try {
    await injector.connectAndInject();
    console.log('✓ 界面已成功热注入到当前 Antigravity 窗口中！');
    setTimeout(() => {
      injector.stop();
      console.log('=== 安装与同步已圆满完成 ===');
      process.exit(0);
    }, 1200);
  } catch (err) {
    console.log('! 未检测到正在运行的客户端，已完成静态安装');
    process.exit(0);
  }
}

install();
