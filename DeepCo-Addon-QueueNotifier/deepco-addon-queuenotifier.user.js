// ==UserScript==
// @name         DeepCo Queue Notifier (Addon)
// @version      0.1.0
// @description  Sends a notification when your queue hits a threshold
// @author       NaN
// @match        https://*.deepco.app/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepco.app
// @license      MIT
// @grant        GM_notification
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // ============================
  // ADDON CONFIG
  // ============================
  const ADDON_ID = 'queueNotifier';
  const ADDON_NAME = 'Queue Notifier';
  const ADDON_DESC =
    'Get notified when your queue reaches a threshold';
  const DEFAULT_ENABLED = true;
  const RUN_ONLY_ON_DIG = true;

  // ============================
  // CONFIG KEYS
  // ============================
  const CFG_OPEN = 'open';
  const CFG_X = 'x';
  const CFG_Y = 'y';
  const CFG_W = 'w';
  const CFG_H = 'h';
  const CFG_THRESHOLD = 'threshold';

  // ============================
  // UI IDS
  // ============================
  const MODAL_ID = `dc-${ADDON_ID}-modal`;
  const HEADER_ID = `dc-${ADDON_ID}-header`;
  const RESIZE_ID = `dc-${ADDON_ID}-resize`;
  const BODY_ID = `dc-${ADDON_ID}-body`;

  let core = null;
  let addonEnabled = false;
  let modalEl = null;
  let unsubTurbo = null;
  let unsubDigEnter = null;
  let unsubDigLeave = null;

  // Observer state
  let currentObserver = null;
  let notificationSent = false;
  let lastElement = null;
  let notificationsSuppressed = false;
  let layerCompleteTextWasVisible = false;
  let lastQueueCount = null;

  // ============================
  // HELPERS
  // ============================
  function log(msg, level = 'info') {
    if (core?.log) core.log(ADDON_ID, msg, level);
    else console.log(`[${ADDON_ID}]`, msg);
  }

  function getCfg(key, defVal) {
    return core?.getAddonConfig
      ? core.getAddonConfig(ADDON_ID, key, defVal)
      : defVal;
  }

  function setCfg(key, val) {
    if (!core?.setAddonConfig) return;
    core.setAddonConfig(ADDON_ID, key, val);
  }

  function isOnDig() {
    return /^\/dig(\/|$)/.test(location.pathname);
  }

  function shouldRunNow() {
    return !RUN_ONLY_ON_DIG || isOnDig();
  }

  // ============================
  // QUEUE MONITORING LOGIC
  // ============================
  function checkLayerCompleteStatus() {
    const layerCompleteText = document.getElementById(
      'layer-complete-text'
    );
    const isVisible = layerCompleteText !== null;

    if (layerCompleteTextWasVisible && !isVisible) {
      log(
        'Layer complete text disappeared, suppressing notifications for 5s'
      );
      notificationsSuppressed = true;

      setTimeout(() => {
        notificationsSuppressed = false;
        log('Notification suppression ended');
      }, 5000);
    }

    layerCompleteTextWasVisible = isVisible;
  }

  function checkQueueStatus() {
    const queueStatusElm = document.getElementById('queue-status');
    if (!queueStatusElm) return;

    if (lastElement && lastElement !== queueStatusElm) {
      log('Element was replaced, re-initializing observer');
      initObserver(queueStatusElm);
    }

    const innerText = queueStatusElm.innerText.trim();
    const queueCount = parseInt(innerText);
    const threshold = getCfg(CFG_THRESHOLD, 0);

    if (!isNaN(queueCount)) {
      lastQueueCount = queueCount;

      if (queueCount <= threshold) {
        if (!notificationSent && !notificationsSuppressed) {
          log(
            `Sending notification - queue is at ${queueCount} (threshold: ${threshold})`
          );
          GM_notification({
            title: 'DeepCo Queue Alert',
            text: `Your queue has ${queueCount} item${
              queueCount === 1 ? '' : 's'
            } left!`,
            timeout: 5000,
          });
          notificationSent = true;
        } else if (notificationsSuppressed) {
          log('Notification suppressed due to layer complete');
        }
      } else if (queueCount > threshold) {
        notificationSent = false;
      }
    }

    // Refresh UI if modal is open
    if (modalEl && modalEl.style.display !== 'none') {
      refreshUI();
    }
  }

  function initObserver(element) {
    if (currentObserver) {
      currentObserver.disconnect();
    }

    lastElement = element;
    currentObserver = new MutationObserver(checkQueueStatus);
    currentObserver.observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    log('Observer attached to queue-status element');
  }

  function startMonitoring() {
    const queueStatusElm = document.getElementById('queue-status');
    if (queueStatusElm) {
      log('Found queue-status element');
      initObserver(queueStatusElm);
      checkQueueStatus();
    }

    // Poll every 2 seconds
    const intervalId = setInterval(() => {
      if (!addonEnabled) {
        clearInterval(intervalId);
        return;
      }

      const elm = document.getElementById('queue-status');
      if (elm && !lastElement) {
        initObserver(elm);
      }

      checkQueueStatus();
      checkLayerCompleteStatus();
    }, 2000);

    // Re-check when tab becomes visible
    const visibilityHandler = () => {
      if (!document.hidden && addonEnabled) {
        checkQueueStatus();
        checkLayerCompleteStatus();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener(
        'visibilitychange',
        visibilityHandler
      );
      if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
      }
    };
  }

  let stopMonitoring = null;

  // ============================
  // MODAL SETUP
  // ============================
  function ensureModal() {
    if (modalEl) return;

    const defaultW = 520;
    const defaultH = 420;
    const w = getCfg(CFG_W, defaultW);
    const h = getCfg(CFG_H, defaultH);

    const defaultX = Math.max(
      20,
      unsafeWindow.innerWidth - (defaultW + 40)
    );
    const defaultY = 100;
    const x = getCfg(CFG_X, defaultX);
    const y = getCfg(CFG_Y, defaultY);

    modalEl = document.createElement('div');
    modalEl.id = MODAL_ID;

    Object.assign(modalEl.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      maxWidth: '95vw',
      maxHeight: '85vh',
      background: 'rgba(12,12,18,0.98)',
      color: '#f8f8ff',
      border: '1px solid #333',
      borderRadius: '10px',
      boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
      zIndex: '999999900',
      display: 'none',
      overflow: 'hidden',
      boxSizing: 'border-box',
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    modalEl.innerHTML = `
      <div id="${HEADER_ID}" style="
        cursor: move;
        padding: 6px 10px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        background:#15151f;
        border-bottom:1px solid #333;
        user-select:none;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:14px;font-weight:700;">${ADDON_NAME}</span>
          <span id="${MODAL_ID}-status" style="font-size:11px;opacity:0.75;"></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" id="${MODAL_ID}-refresh" class="btn btn-xs">Refresh</button>
          <button type="button" id="${MODAL_ID}-close" style="
            border:none;background:transparent;color:#bbb;font-size:18px;cursor:pointer;
          ">×</button>
        </div>
      </div>

      <div id="${BODY_ID}" style="
        padding:10px;
        height: calc(100% - 44px);
        overflow:auto;
        font-size:12px;
      ">
        <div style="opacity:0.8;">Loading...</div>
      </div>

      <div id="${RESIZE_ID}" title="Resize" style="
        position:absolute;right:6px;bottom:6px;width:12px;height:12px;cursor:nwse-resize;opacity:0.65;
        border-right:2px solid rgba(255,255,255,0.35);border-bottom:2px solid rgba(255,255,255,0.35);border-radius:2px;
      "></div>
    `;

    document.body.appendChild(modalEl);

    modalEl.dataset.deepcoModal = '1';
    core?.ui?.registerModalElement?.(modalEl);

    modalEl
      .querySelector(`#${MODAL_ID}-close`)
      ?.addEventListener('click', () => toggleModal(false));
    modalEl
      .querySelector(`#${MODAL_ID}-refresh`)
      ?.addEventListener('click', () => refreshUI());

    const header = modalEl.querySelector(`#${HEADER_ID}`);
    const resizer = modalEl.querySelector(`#${RESIZE_ID}`);

    core?.ui?.makeDraggable?.({
      element: modalEl,
      handle: header,
      persist: { addonId: ADDON_ID, xKey: CFG_X, yKey: CFG_Y },
    });

    core?.ui?.makeResizable?.({
      element: modalEl,
      handle: resizer,
      minW: 340,
      minH: 240,
      persist: { addonId: ADDON_ID, wKey: CFG_W, hKey: CFG_H },
    });

    refreshUI();
  }

  function toggleModal(show) {
    if (!modalEl) return;
    modalEl.style.display = show ? 'block' : 'none';
    setCfg(CFG_OPEN, !!show);

    if (show) {
      core?.ui?.bringToFront?.(modalEl);
      refreshUI();
    }
  }

  function destroyModal() {
    modalEl?.remove();
    modalEl = null;
  }

  // ============================
  // UI RENDERING
  // ============================
  function refreshUI() {
    if (!modalEl) return;

    const threshold = getCfg(CFG_THRESHOLD, 0);
    const queueCount = lastQueueCount ?? 'N/A';
    const layerComplete = layerCompleteTextWasVisible;
    const suppressed = notificationsSuppressed;
    const notifSent = notificationSent;

    const body = modalEl.querySelector(`#${BODY_ID}`);
    if (!body) return;

    body.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div style="border:1px solid #2b2b35;border-radius:10px;padding:10px;min-width:220px;background:rgba(255,255,255,0.03);flex:1;">
          <div style="font-weight:700;margin-bottom:8px;">Queue Status</div>
          <div style="opacity:0.85;line-height:1.6;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>Current Queue:</span>
              <strong>${queueCount}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>Threshold:</span>
              <strong>${threshold}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>Layer Complete:</span>
              <strong style="color:${layerComplete ? '#4ade80' : '#64748b'}">${layerComplete ? 'Yes' : 'No'}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span>Notif. Sent:</span>
              <strong style="color:${notifSent ? '#4ade80' : '#64748b'}">${notifSent ? 'Yes' : 'No'}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span>Suppressed:</span>
              <strong style="color:${suppressed ? '#f87171' : '#64748b'}">${suppressed ? 'Yes' : 'No'}</strong>
            </div>
          </div>
        </div>

        <div style="border:1px solid #2b2b35;border-radius:10px;padding:10px;min-width:220px;background:rgba(255,255,255,0.03);flex:1;">
          <div style="font-weight:700;margin-bottom:8px;">Settings</div>

          <label style="display:block;opacity:0.8;font-size:11px;margin-bottom:4px;">
            Notification Threshold
          </label>
          <input
            type="number"
            id="${MODAL_ID}-threshold"
            value="${threshold}"
            min="0"
            style="
              width:100%;
              padding:6px 8px;
              background:rgba(255,255,255,0.08);
              border:1px solid #333;
              border-radius:6px;
              color:#f8f8ff;
              font-size:13px;
            "
          />
          <div style="margin-top:6px;opacity:0.65;font-size:11px;line-height:1.4;">
            You'll be notified when your queue reaches this number or below.
          </div>
        </div>
      </div>

      <div style="margin-top:10px;padding:10px;border:1px solid #2b2b35;border-radius:10px;background:rgba(255,255,255,0.03);">
        <div style="font-weight:700;margin-bottom:6px;">How It Works</div>
        <ul style="opacity:0.85;line-height:1.5;margin:0;padding-left:20px;font-size:11px;">
          <li>Monitors your queue in real-time</li>
          <li>Sends browser notification when threshold is reached</li>
          <li>Suppresses duplicate notifications until queue grows</li>
          <li>Pauses notifications for 5s after layer completion</li>
        </ul>
      </div>
    `;

    const thresholdInput = body.querySelector(
      `#${MODAL_ID}-threshold`
    );
    thresholdInput?.addEventListener('change', (e) => {
      const value = parseInt(e.target.value);
      if (!isNaN(value) && value >= 0) {
        setCfg(CFG_THRESHOLD, value);
        notificationSent = false;
        log(`Threshold updated to: ${value}`);
        refreshUI();
      }
    });

    modalEl
      .querySelector(`#${MODAL_ID}-status`)
      ?.replaceChildren(
        document.createTextNode(
          `Updated: ${new Date().toLocaleTimeString()}`
        )
      );
  }

  function onNav() {
    if (!addonEnabled) return;


    if (!shouldRunNow()) {
      destroyModal();
      return;
    }

    ensureModal();
    const shouldOpen = getCfg(CFG_OPEN, false);
    toggleModal(!!shouldOpen);
  }

  // ============================
  // CORE REGISTRATION
  // ============================
  function registerWithCore(coreObj) {
    if (core) return;
    core = coreObj;

    core.registerAddon(ADDON_ID, {
      name: ADDON_NAME,
      description: ADDON_DESC,
      defaultEnabled: DEFAULT_ENABLED,

      ui: {
        hideDefaultEnable: false,
        controls: [
          {
            type: 'button',
            label: `Settings`,
            action: 'event',
            eventName: `DeepCo:${ADDON_ID}:toggleModal`,
          },
        ],
      },

      onConfigChange: () => {
        if (!addonEnabled) return;
        if (modalEl && modalEl.style.display !== 'none') {
          refreshUI();
        }
      },

      enable: () => {
        addonEnabled = true;

        onNav();

        stopMonitoring = startMonitoring();

        unsubTurbo =
          core.lifecycle?.onTurbo?.(() => onNav()) || null;
        unsubDigEnter =
          core.lifecycle?.onDigEnter?.(() => onNav()) || null;
        unsubDigLeave =
          core.lifecycle?.onDigLeave?.(() => onNav()) || null;

        log('Enabled');
      },

      disable: () => {
        addonEnabled = false;

        try {
          unsubTurbo?.();
        } catch {}
        try {
          unsubDigEnter?.();
        } catch {}
        try {
          unsubDigLeave?.();
        } catch {}
        unsubTurbo = unsubDigEnter = unsubDigLeave = null;

        if (stopMonitoring) {
          stopMonitoring();
          stopMonitoring = null;
        }

        destroyModal();
        log('Disabled');
      },
    });

    unsafeWindow.addEventListener(
      `DeepCo:${ADDON_ID}:toggleModal`,
      () => {
        if (!addonEnabled || !shouldRunNow()) return;

        ensureModal();
        const visible =
          modalEl && modalEl.style.display !== 'none';
        toggleModal(!visible);
      }
    );

    log('Registered with Core');
  }

  if (unsafeWindow.DeepCoCore) registerWithCore(unsafeWindow.DeepCoCore);
  unsafeWindow.addEventListener('DeepCo:coreReady', (e) =>
    registerWithCore(e.detail)
  );
})();
