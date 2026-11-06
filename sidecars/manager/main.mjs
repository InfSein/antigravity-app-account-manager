/**
 * Antigravity Account Manager 伴随进程启动入口
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { CdpInjector } = require(path.join(__dirname, '..', '..', 'src', 'cdp_injector.js'));
const { DAEMON_PID_FILE, AGY_CONFIG_DIR, LOG_FILE } = require(path.join(__dirname, '..', '..', 'src', 'constants.js'));

function log(msg) {
  const str = `[${new Date().toISOString()}] [Daemon] ${msg}\n`;
  try {
    if (!fs.existsSync(AGY_CONFIG_DIR)) {
      fs.mkdirSync(AGY_CONFIG_DIR, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, str, 'utf8');
  } catch {}
  console.log(msg);
}

log(`[AccountManager Daemon] 启动中, PID: ${process.pid}`);

try {
  if (!fs.existsSync(AGY_CONFIG_DIR)) {
    fs.mkdirSync(AGY_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid), 'utf8');
} catch (e) {
  log(`记录 PID 失败: ${e.message}`);
}

function cleanupPid() {
  try {
    if (fs.existsSync(DAEMON_PID_FILE)) {
      const curPid = fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim();
      if (curPid === String(process.pid)) {
        fs.unlinkSync(DAEMON_PID_FILE);
      }
    }
  } catch {}
}

const injector = new CdpInjector();
injector.start();
log('[AccountManager Daemon] injector.start() 已调用');

process.on('SIGINT', () => {
  cleanupPid();
  injector.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupPid();
  injector.stop();
  process.exit(0);
});

process.on('exit', () => {
  cleanupPid();
});
