/**
 * 前端界面注入脚本
 * 在 Antigravity 2.0 桌面端界面的左下角设置按钮上方插入 Google 账号按钮与多账号管理浮层
 */
const {
  BRIDGE_NAME,
  SETTINGS_BUTTON_SELECTOR,
  ACCOUNT_BTN_ID,
  POPOVER_ID
} = require('./constants');

function getClientInjectionScript() {
  return `(function() {
  const UI_VERSION = '1.3.0';

  // 若已注入相同版本的管理器，仅触发一次状态同步；若版本不同则清理旧节点热更新
  if (window.__agyAccountManager) {
    if (window.__agyAccountManager.version === UI_VERSION) {
      if (typeof window.__agyAccountManager.refreshState === 'function') {
        window.__agyAccountManager.refreshState();
      }
      return;
    }
    if (typeof window.__agyAccountManager.cleanup === 'function') {
      try { window.__agyAccountManager.cleanup(); } catch (e) {}
    } else {
      ['agy-account-manager-style', '${POPOVER_ID}', 'agy-account-confirm-modal', 'agy-account-switch-mask'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    }
  }

  const STORAGE_KEY = '__agy_account_manager_cache__';
  const LANG_STORAGE_KEY = '__agy_account_manager_lang__';
  const CONFIRM_MODAL_ID = 'agy-account-confirm-modal';
  const SWITCH_MASK_ID = 'agy-account-switch-mask';

  // 中英文国际化词典（默认英文）
  const I18N = {
    en: {
      bridgeNotConnected: 'Account manager bridge not connected',
      requestTimeout: 'Request timed out',
      switchingDefault: 'Switching account...',
      confirmRemoveTitle: 'Remove Account',
      confirmRemoveDesc: (email) => \`Are you sure you want to remove <strong>\${email}</strong>? You will need to re-authorize to use it again.\`,
      cancel: 'Cancel',
      confirmRemoveBtn: 'Remove',
      googleAccount: 'Google Account',
      popoverTitle: 'Switch Account',
      activeTag: 'Active',
      removeAccountTitle: 'Remove this account',
      loadingAccounts: 'Loading accounts...',
      waitingAuth: 'Waiting for browser authorization...',
      addAccountBtn: 'Add Google Account',
      switchingTo: (email) => \`Switching to \${email}...\`,
      switchedReloading: (email) => \`Switched to \${email}, reloading...\`,
      switchFailed: (msg) => \`Switch failed: \${msg}\`,
      removingAndSwitching: 'Removing active account and switching...',
      accountRemoved: (email) => \`Removed account \${email}\`,
      removeFailed: (msg) => \`Remove failed: \${msg}\`,
      authOpenedToast: 'Google authorization opened in browser. Please complete sign-in...',
      authSuccessReloading: (email) => \`Authorized (\${email}), switching and reloading...\`,
      addFailed: (msg) => \`Failed to add account: \${msg}\`,
      langSwitchTitle: 'Switch Language / 切换语言'
    },
    zh: {
      bridgeNotConnected: '账号管理通信通道未连接',
      requestTimeout: '请求超时',
      switchingDefault: '正在切换账号...',
      confirmRemoveTitle: '确认移除账号',
      confirmRemoveDesc: (email) => \`确定要移除已保存的账号 <strong>\${email}</strong> 吗？移除后如需再次使用，需重新登录授权。\`,
      cancel: '取消',
      confirmRemoveBtn: '确认移除',
      googleAccount: 'Google 账号',
      popoverTitle: '账号切换',
      activeTag: '使用中',
      removeAccountTitle: '移除该账号',
      loadingAccounts: '正在加载账号信息...',
      waitingAuth: '正在等待网页授权...',
      addAccountBtn: '添加 Google 账号',
      switchingTo: (email) => \`正在切换账号至 \${email}...\`,
      switchedReloading: (email) => \`已切换至 \${email}，正在重载界面...\`,
      switchFailed: (msg) => \`切换失败: \${msg}\`,
      removingAndSwitching: '正在移除当前账号并切换至其他账号...',
      accountRemoved: (email) => \`已移除账号 \${email}\`,
      removeFailed: (msg) => \`移除失败: \${msg}\`,
      authOpenedToast: '已在默认浏览器中打开 Google 授权页面，请在网页中完成登录授权...',
      authSuccessReloading: (email) => \`Google 账号授权成功 (\${email})，正在切换并重载界面...\`,
      addFailed: (msg) => \`添加账号失败: \${msg}\`,
      langSwitchTitle: '切换语言 / Switch Language'
    }
  };

  // 读取本地缓存的账号状态与语言偏好（默认英文 en）
  let cached = null;
  let savedLang = 'en';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) cached = JSON.parse(raw);
    const l = localStorage.getItem(LANG_STORAGE_KEY);
    if (l === 'zh' || l === 'en') savedLang = l;
  } catch (e) {}

  const state = {
    lang: savedLang,
    activeEmail: (cached && cached.activeEmail) || '',
    accounts: (cached && cached.accounts) || [],
    isOpen: false,
    isAdding: false,
    isSwitching: false
  };

  function t(key, ...args) {
    const dict = I18N[state.lang] || I18N.en;
    const val = dict[key] !== undefined ? dict[key] : I18N.en[key];
    return typeof val === 'function' ? val(...args) : val;
  }

  function setLanguage(newLang) {
    const target = newLang === 'zh' ? 'zh' : 'en';
    state.lang = target;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, target);
    } catch (e) {}
    renderButton();
    if (state.isOpen) renderPopover();
  }

  // 1. 全局回调管理 (挂载在全局避免闭包错乱)
  window.__agyAccountPendingRequests = window.__agyAccountPendingRequests || new Map();
  window.__agyAccountReqCounter = window.__agyAccountReqCounter || 0;

  window.__agyAccountCallback = function(id, res) {
    if (window.__agyAccountPendingRequests.has(id)) {
      const { resolve, reject } = window.__agyAccountPendingRequests.get(id);
      window.__agyAccountPendingRequests.delete(id);
      if (res && res.error) reject(new Error(res.error));
      else resolve(res);
    }
  };

  function callBridge(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (typeof window['${BRIDGE_NAME}'] !== 'function') {
        return reject(new Error(t('bridgeNotConnected')));
      }
      const id = ++window.__agyAccountReqCounter;
      window.__agyAccountPendingRequests.set(id, { resolve, reject });
      try {
        window['${BRIDGE_NAME}'](JSON.stringify({ id, action, payload }));
      } catch (err) {
        window.__agyAccountPendingRequests.delete(id);
        reject(err);
      }
      setTimeout(() => {
        if (window.__agyAccountPendingRequests.has(id)) {
          window.__agyAccountPendingRequests.delete(id);
          reject(new Error(t('requestTimeout')));
        }
      }, 180000);
    });
  }

  // 2. 样式表注入（完全跟随 Antigravity 原生主题 CSS 变量）
  const styleId = 'agy-account-manager-style';
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) existingStyle.remove();

  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent = \`
    #\${'${ACCOUNT_BTN_ID}'} {
      position: relative;
    }
    #\${'${ACCOUNT_BTN_ID}'}:hover {
      background-color: var(--sidebar-muted, color-mix(in srgb, var(--foreground, #888) 6%, transparent));
    }
    #\${'${POPOVER_ID}'} {
      position: fixed;
      width: 320px;
      background: var(--card, var(--background, #ffffff));
      color: var(--foreground, #0a0a0c);
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 12%, transparent);
      border-radius: 12px;
      box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.22), 0 4px 12px -2px rgba(0, 0, 0, 0.1);
      z-index: 999999;
      font-family: inherit;
      overflow: hidden;
      animation: agyPopoverIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }
    @keyframes agyPopoverIn {
      from { opacity: 0; transform: translateY(6px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes agyFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes agySpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .agy-popover-header {
      padding: 10px 14px;
      border-bottom: 1px solid color-mix(in srgb, var(--foreground, #888) 8%, transparent);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .agy-popover-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--foreground, #0a0a0c);
    }
    .agy-lang-switch {
      display: inline-flex;
      align-items: center;
      padding: 2px;
      border-radius: 6px;
      background: var(--secondary, color-mix(in srgb, var(--foreground, #888) 7%, transparent));
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 10%, transparent);
      cursor: pointer;
      gap: 2px;
    }
    .agy-lang-opt {
      font-size: 11px;
      line-height: 1;
      padding: 3px 6px;
      border-radius: 4px;
      color: var(--muted-foreground, #71717a);
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .agy-lang-opt:hover {
      color: var(--foreground, #0a0a0c);
    }
    .agy-lang-opt.active {
      background: var(--card, var(--background, #ffffff));
      color: var(--foreground, #0a0a0c);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    }
    .agy-acc-list {
      max-height: 240px;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .agy-acc-empty {
      padding: 16px;
      text-align: center;
      color: var(--muted-foreground, #71717a);
      font-size: 12px;
    }
    .agy-acc-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .agy-acc-item:hover {
      background: color-mix(in srgb, var(--foreground, #888) 6%, transparent);
    }
    .agy-acc-item.active {
      background: color-mix(in srgb, var(--primary, #2f75c3) 12%, transparent);
    }
    .agy-acc-item.active:hover {
      background: color-mix(in srgb, var(--primary, #2f75c3) 16%, transparent);
    }
    .agy-acc-avatar {
      position: relative;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--primary, #2f75c3) 14%, var(--secondary, rgba(128,128,128,0.1)));
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary, #2f75c3);
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 10%, transparent);
    }
    .agy-acc-avatar img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .agy-acc-info {
      flex: 1;
      min-width: 0;
    }
    .agy-acc-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--foreground, #0a0a0c);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-acc-email {
      font-size: 11px;
      color: var(--muted-foreground, #71717a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agy-acc-tag {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--success, #58983f) 16%, transparent);
      color: var(--success, #58983f);
      font-weight: 500;
      margin-left: 6px;
      flex-shrink: 0;
    }
    .agy-acc-actions {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      margin-left: 4px;
      flex-shrink: 0;
    }
    .agy-acc-check {
      color: var(--success, #58983f);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .agy-acc-del-btn {
      display: none;
      opacity: 0;
      padding: 4px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--muted-foreground, #71717a);
      cursor: pointer;
      transition: all 0.15s ease;
      align-items: center;
      justify-content: center;
    }
    .agy-acc-item:hover .agy-acc-check {
      display: none;
    }
    .agy-acc-item:hover .agy-acc-del-btn {
      display: inline-flex;
      opacity: 1;
    }
    .agy-acc-del-btn:hover {
      color: var(--error, #f05151);
      background: color-mix(in srgb, var(--error, #f05151) 14%, transparent);
    }
    .agy-popover-footer {
      padding: 6px;
      border-top: 1px solid color-mix(in srgb, var(--foreground, #888) 8%, transparent);
    }
    .agy-add-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px;
      border-radius: 8px;
      background: var(--secondary, color-mix(in srgb, var(--foreground, #888) 6%, transparent));
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 8%, transparent);
      color: var(--foreground, #0a0a0c);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .agy-add-btn:hover {
      background: color-mix(in srgb, var(--foreground, #888) 11%, transparent);
    }
    .agy-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 10px 16px;
      background: var(--card, var(--background, #ffffff));
      color: var(--foreground, #0a0a0c);
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 14%, transparent);
      border-radius: 8px;
      font-size: 13px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
      z-index: 2000001;
      animation: agyPopoverIn 0.2s ease;
    }
    /* 二次确认弹窗 */
    #\${CONFIRM_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 1000000;
      background: var(--scrim, rgba(0, 0, 0, 0.32));
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: agyFadeIn 0.15s ease;
      user-select: none;
    }
    .agy-confirm-dialog {
      width: 340px;
      background: var(--card, var(--background, #ffffff));
      color: var(--foreground, #0a0a0c);
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 14%, transparent);
      border-radius: 12px;
      padding: 18px 20px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
      animation: agyPopoverIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .agy-confirm-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--foreground, #0a0a0c);
      margin-bottom: 8px;
    }
    .agy-confirm-desc {
      font-size: 12px;
      line-height: 1.5;
      color: var(--muted-foreground, #71717a);
      margin-bottom: 16px;
      word-break: break-all;
    }
    .agy-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .agy-confirm-btn {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      border: 1px solid transparent;
    }
    .agy-confirm-btn-cancel {
      background: var(--secondary, color-mix(in srgb, var(--foreground, #888) 7%, transparent));
      color: var(--foreground, #0a0a0c);
      border-color: color-mix(in srgb, var(--foreground, #888) 10%, transparent);
    }
    .agy-confirm-btn-cancel:hover {
      background: color-mix(in srgb, var(--foreground, #888) 12%, transparent);
    }
    .agy-confirm-btn-danger {
      background: var(--error, #f05151);
      color: #ffffff;
    }
    .agy-confirm-btn-danger:hover {
      filter: brightness(1.08);
    }
    /* 全屏切换毛玻璃遮罩 */
    #\${SWITCH_MASK_ID} {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2000000;
      background: var(--scrim, rgba(0, 0, 0, 0.28));
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: all;
      cursor: wait;
      user-select: none;
      animation: agyFadeIn 0.18s ease;
    }
    .agy-mask-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 20px 28px;
      border-radius: 12px;
      background: var(--card, var(--background, #ffffff));
      color: var(--foreground, #0a0a0c);
      border: 1px solid color-mix(in srgb, var(--foreground, #888) 12%, transparent);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
    }
    .agy-mask-spinner {
      width: 24px;
      height: 24px;
      border: 2.5px solid color-mix(in srgb, var(--primary, #2f75c3) 22%, transparent);
      border-top-color: var(--primary, #2f75c3);
      border-radius: 50%;
      animation: agySpin 0.75s linear infinite;
    }
    .agy-mask-text {
      font-size: 13px;
      font-weight: 500;
      color: var(--foreground, #0a0a0c);
    }
  \`;
  document.head.appendChild(styleEl);

  // 3. 显示 Toast 提示
  function showToast(msg, duration = 3000) {
    const existing = document.getElementById('agy-account-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'agy-account-toast';
    toast.className = 'agy-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, duration);
  }

  // 4. 全屏毛玻璃遮罩控制（切换账号期间锁定整个 App 交互）
  function showSwitchingMask(text) {
    state.isSwitching = true;
    let mask = document.getElementById(SWITCH_MASK_ID);
    if (!mask) {
      mask = document.createElement('div');
      mask.id = SWITCH_MASK_ID;
      // 阻止一切鼠标与键盘穿透交互
      const stopEvent = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      ['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu', 'wheel', 'keydown', 'keyup'].forEach(evt => {
        mask.addEventListener(evt, stopEvent, true);
      });
      document.body.appendChild(mask);
    }
    mask.innerHTML = \`
      <div class="agy-mask-card">
        <div class="agy-mask-spinner"></div>
        <div class="agy-mask-text">\${text || t('switchingDefault')}</div>
      </div>
    \`;
  }

  function hideSwitchingMask() {
    state.isSwitching = false;
    const mask = document.getElementById(SWITCH_MASK_ID);
    if (mask) mask.remove();
  }

  // 5. 二次确认删除弹窗
  function showDeleteConfirmModal(delEmail) {
    return new Promise((resolve) => {
      const existing = document.getElementById(CONFIRM_MODAL_ID);
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = CONFIRM_MODAL_ID;
      overlay.innerHTML = \`
        <div class="agy-confirm-dialog" role="dialog" aria-modal="true">
          <div class="agy-confirm-title">\${t('confirmRemoveTitle')}</div>
          <div class="agy-confirm-desc">\${t('confirmRemoveDesc', delEmail)}</div>
          <div class="agy-confirm-actions">
            <button type="button" class="agy-confirm-btn agy-confirm-btn-cancel" data-action="cancel">\${t('cancel')}</button>
            <button type="button" class="agy-confirm-btn agy-confirm-btn-danger" data-action="confirm">\${t('confirmRemoveBtn')}</button>
          </div>
        </div>
      \`;

      const cleanup = (result) => {
        document.removeEventListener('keydown', onKeyDown, true);
        if (overlay.parentElement) overlay.remove();
        resolve(result);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          cleanup(false);
        }
      };
      document.addEventListener('keydown', onKeyDown, true);

      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('button[data-action]');
        if (btn) {
          cleanup(btn.getAttribute('data-action') === 'confirm');
        } else if (e.target === overlay) {
          cleanup(false);
        }
      });

      document.body.appendChild(overlay);
    });
  }

  // 5.5 同步客户端 nativeStorage 登录状态并自动关闭因多账号切换触发的重复安全提示弹窗
  async function syncOnboardingStorage(email) {
    if (!email) return;
    try {
      if (window.nativeStorage && typeof window.nativeStorage.updateItems === 'function') {
        await window.nativeStorage.updateItems({
          'agy.onboarding.lastLoginUsername': email,
          'agy.onboarding.lastLoginIsGcpTos': 'false',
          'agy.onboarding.welcomeModalSeen': 'true'
        });
      }
    } catch (e) {}
  }

  function autoAcceptTermsModalIfPresent() {
    try {
      const headings = document.querySelectorAll('h2');
      for (const h2 of headings) {
        const text = (h2.textContent || '').trim();
        if (
          text === 'Security Notice & Data Use' ||
          text === 'Terms of Service & Data Use' ||
          text.includes('安全提示与数据使用') ||
          text.includes('服务条款与数据使用')
        ) {
          const dialogContainer = h2.closest('[role="dialog"]') || h2.parentElement?.parentElement?.parentElement;
          if (dialogContainer) {
            const acceptBtn = dialogContainer.querySelector('button[data-autofocus="true"]') || dialogContainer.querySelector('button');
            if (acceptBtn) {
              acceptBtn.click();
              return true;
            }
          }
        }
      }
    } catch (e) {}
    return false;
  }

  if (state.activeEmail) {
    syncOnboardingStorage(state.activeEmail);
  }

  // 6. 渲染/更新左侧按钮
  function renderButton() {
    const settingsBtn = document.querySelector('${SETTINGS_BUTTON_SELECTOR}');
    if (!settingsBtn || !settingsBtn.parentElement) return;

    let btn = document.getElementById('${ACCOUNT_BTN_ID}');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = '${ACCOUNT_BTN_ID}';
      btn.type = 'button';
      btn.className = settingsBtn.className;
      settingsBtn.parentElement.insertBefore(btn, settingsBtn);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover();
      });
    }

    const currentAcc = state.accounts.find(a => a.email.toLowerCase() === (state.activeEmail || '').toLowerCase());
    const displayName = currentAcc ? (currentAcc.name || currentAcc.email.split('@')[0]) : (state.activeEmail || t('googleAccount'));
    const displayAvatar = currentAcc && currentAcc.picture ? currentAcc.picture : '';
    const initialChar = (displayName[0] || 'G').toUpperCase();

    btn.innerHTML = \`
      <span class="shrink-0 flex items-center justify-center w-4 h-4 rounded-full overflow-hidden" style="position: relative; background: var(--primary, #2563eb); color: var(--primary-foreground, #fff); font-size: 10px; font-weight: 600;">
        <span>\${initialChar}</span>
        \${displayAvatar
          ? \`<img src="\${displayAvatar}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">\`
          : ''}
      </span>
      <span class="truncate text-sm flex-1 text-left">\${displayName}</span>
      <span class="shrink-0 text-muted-foreground opacity-60 ml-auto" style="font-size: 10px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
      </span>
    \`;
  }

  // 7. 切换浮层面板展示
  function togglePopover() {
    state.isOpen = !state.isOpen;
    if (state.isOpen) {
      renderPopover();
      refreshState();
    } else {
      closePopover();
    }
  }

  function closePopover() {
    state.isOpen = false;
    const popover = document.getElementById('${POPOVER_ID}');
    if (popover) popover.remove();
  }

  // 8. 渲染弹窗面板内容
  function renderPopover() {
    const btn = document.getElementById('${ACCOUNT_BTN_ID}');
    if (!btn) return;

    let popover = document.getElementById('${POPOVER_ID}');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = '${POPOVER_ID}';
      document.body.appendChild(popover);
    }

    // 定位在账号按钮上方
    const rect = btn.getBoundingClientRect();
    const popoverBottom = window.innerHeight - rect.top + 8;
    const popoverLeft = Math.max(8, rect.left);
    popover.style.bottom = popoverBottom + 'px';
    popover.style.left = popoverLeft + 'px';

    const accountListHtml = state.accounts.map(acc => {
      const isActive = acc.email.toLowerCase() === (state.activeEmail || '').toLowerCase();
      const initial = (acc.name || acc.email)[0].toUpperCase();
      return \`
        <div class="agy-acc-item \${isActive ? 'active' : ''}" data-email="\${acc.email}">
          <div class="agy-acc-avatar">
            <span>\${initial}</span>
            \${acc.picture ? \`<img src="\${acc.picture}" onerror="this.style.display='none'">\` : ''}
          </div>
          <div class="agy-acc-info">
            <div class="flex items-center">
              <span class="agy-acc-name">\${acc.name || acc.email.split('@')[0]}</span>
              \${isActive ? \`<span class="agy-acc-tag">\${t('activeTag')}</span>\` : ''}
            </div>
            <div class="agy-acc-email">\${acc.email}</div>
          </div>
          <div class="agy-acc-actions">
            \${isActive ? \`
              <span class="agy-acc-check">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </span>
            \` : ''}
            <button type="button" class="agy-acc-del-btn" title="\${t('removeAccountTitle')}" data-del="\${acc.email}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      \`;
    }).join('');

    popover.innerHTML = \`
      <div class="agy-popover-header">
        <span class="agy-popover-title">\${t('popoverTitle')}</span>
        <div id="agy-lang-switch" class="agy-lang-switch" title="\${t('langSwitchTitle')}">
          <span class="agy-lang-opt \${state.lang === 'en' ? 'active' : ''}" data-lang="en">EN</span>
          <span class="agy-lang-opt \${state.lang === 'zh' ? 'active' : ''}" data-lang="zh">中文</span>
        </div>
      </div>
      <div class="agy-acc-list">
        \${state.accounts.length > 0 ? accountListHtml : \`<div class="agy-acc-empty">\${t('loadingAccounts')}</div>\`}
      </div>
      <div class="agy-popover-footer">
        <button id="agy-add-account-btn" type="button" class="agy-add-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
          \${state.isAdding ? t('waitingAuth') : t('addAccountBtn')}
        </button>
      </div>
    \`;

    // 绑定右上角语言切换事件
    const langSwitch = document.getElementById('agy-lang-switch');
    if (langSwitch) {
      langSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        const opt = e.target.closest('.agy-lang-opt[data-lang]');
        const clickedLang = opt ? opt.getAttribute('data-lang') : null;
        if (clickedLang && clickedLang !== state.lang) {
          setLanguage(clickedLang);
        } else {
          setLanguage(state.lang === 'en' ? 'zh' : 'en');
        }
      });
    }

    // 绑定切换账号事件
    popover.querySelectorAll('.agy-acc-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.agy-acc-del-btn')) return;
        const targetEmail = el.getAttribute('data-email');
        if (targetEmail && targetEmail.toLowerCase() !== (state.activeEmail || '').toLowerCase()) {
          closePopover();
          showSwitchingMask(t('switchingTo', targetEmail));
          try {
            await syncOnboardingStorage(targetEmail);
            await callBridge('switch_account', { email: targetEmail });
            await syncOnboardingStorage(targetEmail);
            state.activeEmail = targetEmail;
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({
                activeEmail: state.activeEmail,
                accounts: state.accounts
              }));
            } catch (e) {}

            renderButton();
            showSwitchingMask(t('switchedReloading', targetEmail));

            // 延迟 600ms 刷新当前窗口，期间保持毛玻璃遮罩防止误操作
            setTimeout(() => {
              window.location.reload();
            }, 600);
          } catch (err) {
            hideSwitchingMask();
            showToast(t('switchFailed', err.message));
          }
        }
      });
    });

    // 绑定删除账号事件（带二次确认弹窗）
    popover.querySelectorAll('.agy-acc-del-btn').forEach(delBtn => {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const delEmail = delBtn.getAttribute('data-del');
        if (!delEmail) return;
        const confirmed = await showDeleteConfirmModal(delEmail);
        if (!confirmed) return;

        const isDeletingActive = delEmail.toLowerCase() === (state.activeEmail || '').toLowerCase();
        if (isDeletingActive && state.accounts.length > 1) {
          closePopover();
          showSwitchingMask(t('removingAndSwitching'));
        }

        try {
          await callBridge('remove_account', { email: delEmail });
          showToast(t('accountRemoved', delEmail));
          await refreshState();
          // 如果删除的是当前激活账号，刷新页面以加载下一个账号
          if (isDeletingActive) {
            setTimeout(() => { window.location.reload(); }, 600);
          }
        } catch (err) {
          hideSwitchingMask();
          showToast(t('removeFailed', err.message));
        }
      });
    });

    // 绑定添加账号事件
    const addBtn = document.getElementById('agy-add-account-btn');
    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        if (state.isAdding) return;
        state.isAdding = true;
        renderPopover();
        showToast(t('authOpenedToast'));
        try {
          const res = await callBridge('add_account', { lang: state.lang });
          if (res && res.email) {
            await syncOnboardingStorage(res.email);
          }
          closePopover();
          showSwitchingMask(t('authSuccessReloading', res.email || ''));
          await refreshState();
          setTimeout(() => {
            window.location.reload();
          }, 600);
        } catch (err) {
          hideSwitchingMask();
          showToast(t('addFailed', err.message));
        } finally {
          state.isAdding = false;
          if (state.isOpen) renderPopover();
        }
      });
    }
  }

  // 9. 刷新全局状态
  async function refreshState() {
    try {
      const data = await callBridge('get_accounts');
      if (data && Array.isArray(data.accounts)) {
        state.activeEmail = data.activeEmail || '';
        state.accounts = data.accounts;
        if (state.activeEmail) {
          syncOnboardingStorage(state.activeEmail);
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            activeEmail: state.activeEmail,
            accounts: state.accounts
          }));
        } catch (e) {}
        renderButton();
        if (state.isOpen) renderPopover();
        return true;
      }
    } catch (e) {
      // 失败时保持现有 state 和缓存
    }
    return false;
  }

  // 10. 点击空白处收起浮层（忽略二次确认弹窗内的点击）
  const onDocClick = (e) => {
    if (state.isOpen) {
      const confirmModal = document.getElementById(CONFIRM_MODAL_ID);
      if (confirmModal && confirmModal.contains(e.target)) return;
      const popover = document.getElementById('${POPOVER_ID}');
      const btn = document.getElementById('${ACCOUNT_BTN_ID}');
      if (popover && !popover.contains(e.target) && btn && !btn.contains(e.target)) {
        closePopover();
      }
    }
  };
  document.addEventListener('click', onDocClick);

  // 11. 监听页面 DOM 变动确保按钮持续驻留并自动处理切换账号过渡期的条款弹窗
  let observerDebounce = null;
  const observer = new MutationObserver(() => {
    autoAcceptTermsModalIfPresent();
    if (observerDebounce) return;
    observerDebounce = setTimeout(() => {
      observerDebounce = null;
      const settingsBtn = document.querySelector('${SETTINGS_BUTTON_SELECTOR}');
      const myBtn = document.getElementById('${ACCOUNT_BTN_ID}');
      if (settingsBtn && (!myBtn || myBtn.nextElementSibling !== settingsBtn)) {
        renderButton();
      }
    }, 600);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    autoAcceptTermsModalIfPresent();
  }

  // 暴露单例对象与清理函数供热更新调用
  window.__agyAccountManager = {
    version: UI_VERSION,
    state,
    setLanguage,
    refreshState,
    renderButton,
    renderPopover,
    togglePopover,
    closePopover,
    cleanup() {
      document.removeEventListener('click', onDocClick);
      observer.disconnect();
      if (observerDebounce) clearTimeout(observerDebounce);
      [styleId, '${POPOVER_ID}', CONFIRM_MODAL_ID, SWITCH_MASK_ID].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    }
  };

  // 12. 立即挂载按钮并刷新状态
  renderButton();
  refreshState();

  // 若初次桥接未建立，稍后重试一次
  setTimeout(refreshState, 1000);
})();`;
}

module.exports = {
  getClientInjectionScript
};
