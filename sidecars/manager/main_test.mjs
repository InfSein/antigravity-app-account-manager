import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const logPath = 'C:\\Users\\InfSein\\.gemini\\antigravity\\brain\\f2cafeb6-7448-4b97-8a28-e9b687b7ba45\\scratch\\daemon_full.log';
function log(msg) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
}

log(`Starting daemon full test, PID=${process.pid}`);

process.on('uncaughtException', (err) => {
  log(`uncaughtException: ${err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
});
process.on('exit', (code) => {
  log(`Process exiting with code ${code}`);
});
process.on('SIGINT', () => {
  log('SIGINT received');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('SIGTERM received');
  process.exit(0);
});

try {
  const { CdpInjector } = require(path.join(__dirname, '..', '..', 'src', 'cdp_injector.js'));
  const injector = new CdpInjector();
  injector.start();
  log('injector.start() executed');
} catch (e) {
  log(`Exception in setup: ${e.stack || e}`);
}

setInterval(() => {
  log('Tick alive');
}, 5000);
