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
  // 单例保护：如果已经注入过管理器，则仅触发一次状态同步，不重复初始化或覆盖监听
  if (window.__agyAccountManager) {
    if (typeof window.__agyAccountManager.refreshState === 'function') {
      window.__agyAccountManager.refreshState();
    }
    return;
  }

  const STORAGE_KEY = '__agy_account_manager_cache__';

  // 读取本地缓存的账号状态以实现瞬间秒开渲染
  let cached = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch (e) {}

  const state = {
    activeEmail: (cached && cached.activeEmail) || '',
    accounts: (cached && cached.accounts) || [],
    isOpen: false,
    isAdding: false,
    isSwitching: false
  };

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
        return reject(new Error('账号管理通信通道未连接'));
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
          reject(new Error('请求超时'));
        }
      }, 180000);
    });
  }

  // 2. 样式表注入
  const styleId = 'agy-account-manager-style';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = \`
      #\${'${ACCOUNT_BTN_ID}'} {
        position: relative;
      }
      #\${'${ACCOUNT_BTN_ID}'}:hover {
        background-color: var(--sidebar-muted, rgba(255, 255, 255, 0.08));
      }
      #\${'${POPOVER_ID}'} {
        position: fixed;
        width: 320px;
        background: #18181b;
        color: #f4f4f5;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.05);
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
        background: rgba(255, 255, 255, 0.07);
      }
      .agy-acc-item.active {
        background: rgba(59, 130, 246, 0.15);
      }
      .agy-acc-avatar {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: #27272a;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
        font-size: 13px;
        font-weight: 600;
        color: #93c5fd;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .agy-acc-avatar img {
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
        color: #f4f4f5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .agy-acc-email {
        font-size: 11px;
        color: #a1a1aa;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .agy-acc-tag {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 10px;
        background: rgba(34, 197, 94, 0.2);
        color: #4ade80;
        font-weight: 500;
        margin-left: 4px;
      }
      .agy-acc-del-btn {
        opacity: 0;
        padding: 4px;
        border-radius: 4px;
        color: #71717a;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .agy-acc-item:hover .agy-acc-del-btn {
        opacity: 1;
      }
      .agy-acc-del-btn:hover {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.15);
      }
      .agy-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 10px 16px;
        background: #18181b;
        color: #fff;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        font-size: 13px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        z-index: 1000000;
        animation: agyPopoverIn 0.2s ease;
      }
    \`;
    document.head.appendChild(styleEl);
  }

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

  // 4. 渲染/更新左侧按钮
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
    const displayName = currentAcc ? (currentAcc.name || currentAcc.email.split('@')[0]) : (state.activeEmail || 'Google 账号');
    const displayAvatar = currentAcc && currentAcc.picture ? currentAcc.picture : '';
    const initialChar = (displayName[0] || 'G').toUpperCase();

    btn.innerHTML = \`
      <span class="shrink-0 flex items-center justify-center w-4 h-4 rounded-full overflow-hidden" style="background: #2563eb; color: #fff; font-size: 10px; font-weight: 600;">
        \${displayAvatar
          ? \`<img src="\${displayAvatar}" class="w-full h-full object-cover" onerror="this.remove()">\`
          : \`<span>\${initialChar}</span>\`}
      </span>
      <span class="truncate text-sm flex-1 text-left">\${displayName}</span>
      <span class="shrink-0 text-muted-foreground opacity-60 ml-auto" style="font-size: 10px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
      </span>
    \`;
  }

  // 5. 切换浮层面板展示
  function togglePopover() {
    state.isOpen = !state.isOpen;
    if (state.isOpen) {
      renderPopover();
      // 展开时立即拉取最新账号列表以确保展示最新数据
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

  // 6. 渲染弹窗面板内容
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
            \${acc.picture ? \`<img src="\${acc.picture}" onerror="this.remove()">\` : initial}
          </div>
          <div class="agy-acc-info">
            <div class="flex items-center">
              <span class="agy-acc-name">\${acc.name || acc.email.split('@')[0]}</span>
              \${isActive ? '<span class="agy-acc-tag">使用中</span>' : ''}
            </div>
            <div class="agy-acc-email">\${acc.email}</div>
          </div>
          \${isActive ? \`
            <span style="color: #4ade80; margin-left: 4px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </span>
          \` : \`
            <div class="agy-acc-del-btn" title="移除该账号" data-del="\${acc.email}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </div>
          \`}
        </div>
      \`;
    }).join('');

    popover.innerHTML = \`
      <div style="padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 13px; font-weight: 600; color: #fff;">Google 账号切换</span>
        <span style="font-size: 11px; color: #71717a;">\${state.accounts.length} 个账号</span>
      </div>
      <div style="max-height: 240px; overflow-y: auto; padding: 6px;">
        \${state.accounts.length > 0 ? accountListHtml : '<div style="padding: 16px; text-align: center; color: #71717a; font-size: 12px;">正在加载账号信息...</div>'}
      </div>
      <div style="padding: 6px; border-top: 1px solid rgba(255,255,255,0.08);">
        <button id="agy-add-account-btn" type="button" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px; border-radius: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: #f4f4f5; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.15s ease;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
          \${state.isAdding ? '正在等待网页授权...' : '添加 Google 账号'}
        </button>
      </div>
    \`;

    // 绑定切换账号事件
    popover.querySelectorAll('.agy-acc-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.agy-acc-del-btn')) return;
        const targetEmail = el.getAttribute('data-email');
        if (targetEmail && targetEmail.toLowerCase() !== (state.activeEmail || '').toLowerCase()) {
          try {
            showToast('正在切换账号到 ' + targetEmail + '...');
            el.style.opacity = '0.5';
            await callBridge('switch_account', { email: targetEmail });
            state.activeEmail = targetEmail;
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({
                activeEmail: state.activeEmail,
                accounts: state.accounts
              }));
            } catch (e) {}

            try {
              const bc = new BroadcastChannel("jetski_ls_auth_channel");
              bc.postMessage({ type: "SIGN_IN", timestamp: Date.now() });
            } catch (e) {}

            renderButton();
            renderPopover();
            showToast('已成功切换至 ' + targetEmail);
            closePopover();
          } catch (err) {
            showToast('切换失败: ' + err.message);
            el.style.opacity = '1';
          }
        }
      });
    });

    // 绑定删除账号事件
    popover.querySelectorAll('.agy-acc-del-btn').forEach(delBtn => {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const delEmail = delBtn.getAttribute('data-del');
        if (!confirm('确定要移除已保存的账号 ' + delEmail + ' 吗？')) return;
        try {
          await callBridge('remove_account', { email: delEmail });
          showToast('已移除账号 ' + delEmail);
          await refreshState();
        } catch (err) {
          showToast('移除失败: ' + err.message);
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
        showToast('已在默认浏览器中打开 Google 授权页面，请在网页中完成登录授权...');
        try {
          const res = await callBridge('add_account');
          showToast('Google 账号授权成功: ' + (res.email || ''));
          await refreshState();
          closePopover();
          try {
            const bc = new BroadcastChannel("jetski_ls_auth_channel");
            bc.postMessage({ type: "SIGN_IN", timestamp: Date.now() });
          } catch (e) {}
        } catch (err) {
          showToast('添加账号失败: ' + err.message);
        } finally {
          state.isAdding = false;
          if (state.isOpen) renderPopover();
        }
      });
    }
  }

  // 7. 刷新全局状态
  async function refreshState() {
    try {
      const data = await callBridge('get_accounts');
      if (data && Array.isArray(data.accounts)) {
        state.activeEmail = data.activeEmail || '';
        state.accounts = data.accounts;
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

  // 暴露单例对象供调用
  window.__agyAccountManager = {
    state,
    refreshState,
    renderButton,
    renderPopover,
    togglePopover,
    closePopover
  };

  // 8. 点击空白处收起浮层
  document.addEventListener('click', (e) => {
    if (state.isOpen) {
      const popover = document.getElementById('${POPOVER_ID}');
      const btn = document.getElementById('${ACCOUNT_BTN_ID}');
      if (popover && !popover.contains(e.target) && btn && !btn.contains(e.target)) {
        closePopover();
      }
    }
  });

  // 9. 监听页面 DOM 变动确保按钮持续驻留 (带防抖保护，避免性能损耗)
  let observerDebounce = null;
  const observer = new MutationObserver(() => {
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
  }

  // 10. 立即挂载按钮并刷新状态
  renderButton();
  refreshState();

  // 若初次桥接未建立，稍后重试一次
  setTimeout(refreshState, 1000);
})();`;
}

module.exports = {
  getClientInjectionScript
};
