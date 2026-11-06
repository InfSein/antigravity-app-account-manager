/**
 * 会话启动钩子 (SessionStart Hook)
 * 在会话启动时触发，执行初始化检测与界面注入
 */
const path = require('path');
const { initAccountStore } = require('../src/account_store');
const { CdpInjector } = require('../src/cdp_injector');

console.log('[AccountManager Hook] SessionStart 触发，检查账号状态...');
initAccountStore();

const injector = new CdpInjector();
injector.connectAndInject().then(() => {
  // 注入完成后让进程平稳退出，常驻监听交由 Sidecar 伴随进程处理
  setTimeout(() => {
    injector.stop();
    process.exit(0);
  }, 2000);
}).catch(() => {
  process.exit(0);
});
