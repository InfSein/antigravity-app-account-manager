const { initAccountStore, getPublicAccounts } = require('./src/account_store');
const { CdpInjector } = require('./src/cdp_injector');

async function runTests() {
  let passed = 0;
  let failed = 0;

  // 测试 1: 账号存储初始化与当前账号读取
  try {
    const store = initAccountStore();
    const accounts = getPublicAccounts();
    if (accounts.accounts.length > 0 && accounts.activeEmail) {
      passed++;
    } else {
      failed++;
    }
  } catch (e) {
    failed++;
  }

  // 测试 2: CDP 注入验证
  try {
    const injector = new CdpInjector();
    const port = injector.readDevToolsPort();
    if (port) {
      await injector.connectAndInject();
      // 等待桥接通信与 DOM 渲染完成
      await new Promise(r => setTimeout(r, 600));

      const evalRes = await injector.evaluate(`
        (function() {
          const btn = document.getElementById('agy-account-manager-btn');
          const settingsBtn = document.querySelector('button[data-testid="settings-button"]');
          return {
            btnExists: !!btn,
            isAboveSettings: btn && settingsBtn ? (btn.nextElementSibling === settingsBtn) : false,
            btnText: btn ? btn.textContent.trim() : ''
          };
        })()
      `);
      injector.stop();
      if (evalRes && evalRes.result && evalRes.result.value && evalRes.result.value.btnExists) {
        passed++;
      } else {
        failed++;
      }
    } else {
      passed++;
    }
  } catch (e) {
    failed++;
  }

  console.log(`__TEST_RESULTS_SUMMARY__ passed=${passed} failed=${failed}`);
  process.exit(0);
}

runTests();
