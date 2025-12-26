// ==UserScript==
// @name         DeepCo Core
// @version      V0.4
// @description  Addon Manager for DeepCo
// @author       diehard2k0
// @match        https://*.deepco.app/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepco.app
// @license      MIT
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        unsafeWindow
// ==/UserScript==

(async function () {
  'use strict';

  const SCHEMA = [['Timestamp', 'TileCount', 'RC', 'Level', 'DC', 'DCIncome', 'Processing Rating', 'DeptTag']];
  const STORAGE_KEY = 'nudgeLogs';
  const ADDONS_MODAL_POS_KEY = 'dcAddonsModalPos';
  const ADDONS_MODAL_OPEN_KEY = 'dcAddonsModalOpen';
  const ADDON_STATE_PREFIX = 'dcAddon_';
  const ADDON_CONFIG_PREFIX = 'dcAddonCfg_';
  const ADDON_ORDER_KEY = 'dcAddonOrder';
  const addons = {};

  let addonsHeartbeatStarted = false;
  let db = await GM.getValue(STORAGE_KEY, SCHEMA);

  let coreReady = false;
  let addonOrder = loadAddonOrder();
  let addonsDragSetupDone = false;
  let dcMessageObserver = null;
  fixTimestamps(db);
  normalizeDb(db);


  function normalizeDb(dbArr) {
    const neededLen = SCHEMA[0].length;
    for (let i = 1; i < dbArr.length; i++) {
      const row = dbArr[i];
      while (row.length < neededLen) row.push('');
    }
  }

  function fixTimestamps(dbArr) {
    for (let i = 1; i < dbArr.length; i++) {
      const ts = dbArr[i][0];
      if (typeof ts === 'string') {
        dbArr[i][0] = new Date(ts.replace(' ', 'T')).getTime();
      }
    }
  }

  function isOnDigPage() {
    return location.pathname.startsWith('/dig') || !!document.querySelector('.nudge-animation');
  }

  function getTileCount() {
    const frameEl = document.querySelector('.nudge-animation');
    if (!frameEl) return 0;
    const txt = (frameEl.textContent || frameEl.innerHTML || '').trim();
    const v = parseInt(txt.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(v) ? v : 0;
  }

  function getRCCount() {
    const span = document.querySelector('span.flex:nth-child(2) > span:nth-child(1)');
    if (!span) return 0;
    const t = (span.textContent || span.innerText || '').trim();
    const n = parseFloat(t.replace(/[^0-9\.]+/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function getDCCount() {
    try {
      const workerCoins = document.querySelector('#worker_coins');
      if (!workerCoins) return 0;
      const badgeEl = workerCoins.querySelector('span');
      const text = badgeEl ? (badgeEl.textContent || badgeEl.innerText || '').trim() : '';
      if (!text) return 0;
      const match = text.match(/(\d+(?:\.\d+)?)\s*\[DC\]/i);
      if (!match) return 0;
      const n = parseFloat(match[1]);
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      console.error('[DeepCo Core] getDCCount error:', e);
      return 0;
    }
  }

  function parseDCIncomeFromText(text) {
    const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*\[DC\]/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : 0;
  }

  function getDCIncomeFromFlashHtml(flashHtml) {
    try {
      if (!flashHtml) return 0;
      const tmp = document.createElement('div');
      tmp.innerHTML = flashHtml;
      const text = tmp.textContent || tmp.innerText || '';
      return parseDCIncomeFromText(text);
    } catch (e) {
      console.error('[DeepCo Core] getDCIncomeFromFlashHtml error:', e);
      return 0;
    }
  }

  function getProcessingRating() {
    const el = document.querySelector(
      '[data-section="stats"] [data-tip="Processing Rating"] [data-stat="damage_rating"]'
    );
    return el ? el.textContent.trim() : '';
  }

  function getLevel() {
    try {
      const select = document.querySelector('#grid-shadow-departments > div > select');
      if (!select) return 0;
      const selected = select.querySelector('option[selected]') || select.options[select.selectedIndex];
      const text = (selected ? selected.textContent : '') || '';
      const match = String(text).trim().match(/dc\+?(\d+)/i);
      if (!match) return 0;
      const n = parseInt(match[1], 10);
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      console.error('[DeepCo Core] getLevel error:', e);
      return 0;
    }
  }

  function getDeptTag() {
    const select = document.querySelector('#grid-shadow-departments > div > select');
    if (!select) return '';
    let opt = select.querySelector('option[selected]');
    if (!opt) opt = select.options[select.selectedIndex] || select.options[0];
    return opt ? String(opt.textContent || '').trim() : '';
  }

  function injectCssOnce(id, cssText) {
    const styleId = `dc-style-${id}`;
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  let zCounter = 999999900;
  function bringToFront(element) {
    if (!element) return;
    zCounter += 1;
    element.style.zIndex = String(zCounter);
  }

  function registerModalElement(element, { bringToFrontOnRegister = true } = {}) {
    if (!element) return;
    element.dataset.deepcoModal = '1';
    element.addEventListener('mousedown', () => bringToFront(element), true);
    if (bringToFrontOnRegister) bringToFront(element);
  }

  document.addEventListener('mousedown', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-deepco-modal="1"]') : null;
    if (el) bringToFront(el);
  }, true);

  function makeDraggable({ element, handle, onStop, persist, bringToFrontOnMouseDown = true }) {
    if (!element || !handle) return () => {};
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    handle.style.cursor = handle.style.cursor || 'move';

    const onDown = (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, input, select, textarea, label')) return;
      if (bringToFrontOnMouseDown) bringToFront(element);

      dragging = true;
      const rect = element.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const left = startLeft + dx;
      const top = startTop + dy;
      element.style.left = left + 'px';
      element.style.top = top + 'px';
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const rect = element.getBoundingClientRect();
      if (persist && persist.addonId && persist.xKey && persist.yKey) {
        DeepCoCore.setAddonConfig(persist.addonId, persist.xKey, rect.left);
        DeepCoCore.setAddonConfig(persist.addonId, persist.yKey, rect.top);
      }
      if (typeof onStop === 'function') onStop(rect);
    };

    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    return () => {
      handle.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }

  function makeResizable({ element, handle, minW = 280, minH = 180, onStop, persist, bringToFrontOnMouseDown = true }) {
    if (!element || !handle) return () => {};
    let resizing = false;
    let startX = 0, startY = 0, startW = 0, startH = 0;

    const onDown = (e) => {
      if (e.button !== 0) return;
      if (bringToFrontOnMouseDown) bringToFront(element);

      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const w = Math.max(minW, startW + dx);
      const h = Math.max(minH, startH + dy);
      element.style.width = w + 'px';
      element.style.height = h + 'px';
    };

    const onUp = () => {
      if (!resizing) return;
      resizing = false;
      const rect = element.getBoundingClientRect();
      if (persist && persist.addonId && persist.wKey && persist.hKey) {
        DeepCoCore.setAddonConfig(persist.addonId, persist.wKey, Math.round(rect.width));
        DeepCoCore.setAddonConfig(persist.addonId, persist.hKey, Math.round(rect.height));
      }
      if (typeof onStop === 'function') onStop(rect);
    };

    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    return () => {
      handle.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }

  const lifecycle = (() => {
    const turboCbs = new Set();
    const digEnterCbs = new Set();
    const digLeaveCbs = new Set();

    let lastPath = location.pathname;
    let lastDig = isOnDigPage();

    function fire(set, arg) {
      set.forEach(fn => { try { fn(arg); } catch (e) { console.error('[DeepCo Core] lifecycle cb error', e); } });
    }

    function tick() {
      const path = location.pathname;
      const dig = isOnDigPage();

      if (path !== lastPath) {
        lastPath = path;
        fire(turboCbs, { type: 'path', path });
      }

      if (dig !== lastDig) {
        lastDig = dig;
        fire(turboCbs, { type: 'dig', dig });
        if (dig) fire(digEnterCbs, {});
        else fire(digLeaveCbs, {});
      }
    }

    function onTurboEvent() {
      setTimeout(() => {
        tick();
        DcMessageObserver();
        ensureAddonsButtonAndModal();
        startAddonsUiHeartbeat();
      }, 0);
    }

    window.addEventListener('turbo:load', onTurboEvent);
    window.addEventListener('turbo:render', onTurboEvent);
    window.addEventListener('turbo:frame-load', onTurboEvent);

    setInterval(tick, 750);

    return {
      onTurbo(cb) { turboCbs.add(cb); return () => turboCbs.delete(cb); },
      onDigEnter(cb) { digEnterCbs.add(cb); return () => digEnterCbs.delete(cb); },
      onDigLeave(cb) { digLeaveCbs.add(cb); return () => digLeaveCbs.delete(cb); }
    };
  })();

    //Core for addons
  const DeepCoCore = {
    getDb() {
      return db.map(row => row.slice());
    },

    getOperName() {
        try {
          return document.getElementsByClassName("text-lg font-semibold leading-tight flex-1 truncate")[0].innerText
        } catch {
          return ''
      }
    },

    onReady(cb) {
      if (coreReady) cb({ db: DeepCoCore.getDb() });
      unsafeWindow.addEventListener('DeepCo:ready', (e) => cb(e.detail));
    },

    onLog(cb) {
      unsafeWindow.addEventListener('DeepCo:log', (e) => cb(e.detail));
    },

    registerAddon(id, options) {
      if (!id) return;
      if (!options) options = {};

      const existing = addons[id];
      const addon = existing || {
        id,
        name: options.name || id,
        description: options.description || '',
        enable: options.enable || (() => {}),
        disable: options.disable || (() => {}),
        defaultEnabled: options.defaultEnabled !== false,
        enabled: false,
        ui: options.ui || null,
        onConfigChange: options.onConfigChange || null
      };

      if (!existing) {
        addons[id] = addon;
        if (!addonOrder.includes(id)) {
          addonOrder.push(id);
          saveAddonOrder();
        }
      } else {
        addon.name = options.name || addon.name;
        addon.description = options.description || addon.description;
        addon.enable = options.enable || addon.enable;
        addon.disable = options.disable || addon.disable;
        addon.ui = options.ui || addon.ui || null;
        addon.onConfigChange = options.onConfigChange || addon.onConfigChange;
        if (typeof options.defaultEnabled === 'boolean') addon.defaultEnabled = options.defaultEnabled;
      }

      const saved = localStorage.getItem(ADDON_STATE_PREFIX + id);
      const shouldEnable = saved === null ? addon.defaultEnabled : saved === 'true';
      addon.enabled = shouldEnable;

      try {
        if (shouldEnable && addon.enable) addon.enable();
        if (!shouldEnable && addon.disable) addon.disable();
      } catch (e) {
        console.error('[DeepCo Core] Error calling addon', id, 'handler:', e);
      }

      renderAddonsModalContent();
      DeepCoCore.log('DeepCo Core', `Registered addon: ${id} enabled flag: ${shouldEnable}`);
    },

    getAddonConfig(addonId, key, defaultValue) {
      const raw = localStorage.getItem(ADDON_CONFIG_PREFIX + addonId + '_' + key);
      if (raw === null) return defaultValue;
      try { return JSON.parse(raw); } catch { return raw; }
    },

    setAddonConfig(addonId, key, value) {
      localStorage.setItem(ADDON_CONFIG_PREFIX + addonId + '_' + key, JSON.stringify(value));
      const addon = addons[addonId];
      if (addon && typeof addon.onConfigChange === 'function') {
        try { addon.onConfigChange(key, value); }
        catch (e) { console.error('[DeepCo Core] onConfigChange error for addon', addonId, e); }
      }
    },

    utils: {
      isOnDigPage,
      getTileCount,
      getRCCount,
      getDCCount,
      getDCIncomeFromFlashHtml,
      getDCIncomeFromText: parseDCIncomeFromText,
      getProcessingRating,
      getLevel,
      getDeptTag
    },

    ui: {
      injectCssOnce,
      bringToFront,
      registerModalElement,
      makeDraggable,
      makeResizable
    },

    lifecycle,

    log(addonId, message, level = 'info') {
      const styles = {
        info:  'color:#4fc3f7; font-weight:bold;',
        warn:  'color:#ffb74d; font-weight:bold;',
        error: 'color:#ef5350; font-weight:bold;',
        debug: 'color:#9e9e9e; font-weight:bold;'
      };
      const prefixStyle = 'color:#81c784; font-weight:bold;';
      const addonStyle = 'color:#ba68c8; font-weight:bold;';
      const msgStyle = styles[level] || styles.info;

      console.log(
        `%c[DeepCo Core]%c[${addonId}]%c ${message}`,
        prefixStyle,
        addonStyle,
        msgStyle
      );
    }
  };

  unsafeWindow.DeepCoCore = DeepCoCore;

  function injectAddonsUiCss() {
    DeepCoCore.ui.injectCssOnce('addons-ui', `
      #dc-addons-modal { font-size: 13px; line-height: 1.4; }
      .dc-addon-entry { margin-bottom: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid #333; }
      .dc-addon-entry:last-child { border-bottom: none; }
      .dc-addon-entry.dc-addon-dragging { opacity: 0.55; border-style: dashed; }
      .dc-addon-header { display:flex; justify-content:space-between; align-items:center; gap:8px; cursor:grab; }
      .dc-addon-entry.dc-addon-dragging .dc-addon-header { cursor:grabbing; }
      .dc-addon-header-left { flex: 1 1 auto; }
      .dc-addon-header-right { flex: 0 0 auto; display:flex; align-items:center; gap:6px; }
      .dc-addon-name { font-weight:bold; font-size:0.9rem; }
      .dc-addon-desc { font-size:0.75rem; opacity:0.8; }
      .dc-addon-controls { margin-top:0.35rem; }
      .dc-addon-control-row { display:block !important; margin:4px 0; }
      .dc-addon-control-row label { margin-right:4px; }
      .dc-addon-control-row select,
      .dc-addon-control-row input[type="checkbox"],
      .dc-addon-control-row button { margin-left:2px; }
    `);
  }

  function startAddonsUiHeartbeat() {
    if (addonsHeartbeatStarted) return;
    addonsHeartbeatStarted = true;
    setInterval(() => ensureAddonsButtonAndModal(), 1000);
  }

  function ensureAddonsButtonAndModal() {
    const statsContainer = document.querySelector('li[data-section="stats"] div[data-component="damage-stats"]');
    if (!statsContainer) return;

    let btn = document.getElementById('dc-addons-open-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'dc-addons-open-btn';
      btn.textContent = 'Addons';
      btn.className = 'btn btn-xs mt-1';
      btn.style.marginTop = '4px';
      btn.style.alignSelf = 'flex-end';
      btn.addEventListener('click', () => {
        const modal = document.getElementById('dc-addons-modal');
        if (!modal) return;
        const open = modal.style.display === 'block';
        modal.style.display = open ? 'none' : 'block';
        localStorage.setItem(ADDONS_MODAL_OPEN_KEY, open ? 'false' : 'true');
        if (!open) DeepCoCore.ui.bringToFront(modal);
      });
      statsContainer.appendChild(btn);
    }

    let modal = document.getElementById('dc-addons-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'dc-addons-modal';
      Object.assign(modal.style, {
        position: 'fixed',
        zIndex: '999998',
        backgroundColor: 'rgba(17, 17, 17, 0.98)',
        border: '1px solid #444',
        borderRadius: '6px',
        padding: '0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        minWidth: '320px',
        maxWidth: '520px'
      });
      document.body.appendChild(modal);
      DeepCoCore.ui.registerModalElement(modal);
    } else {
      if (modal.dataset.deepcoModal !== '1') DeepCoCore.ui.registerModalElement(modal, { bringToFrontOnRegister: false });
    }

    if (!modal.style.left || !modal.style.top) {
      const savedPos = JSON.parse(localStorage.getItem(ADDONS_MODAL_POS_KEY) || 'null');
      if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        modal.style.left = savedPos.left + 'px';
        modal.style.top = savedPos.top + 'px';
      } else {
        modal.style.left = '150px';
        modal.style.top = '150px';
        localStorage.setItem(ADDONS_MODAL_POS_KEY, JSON.stringify({ left: 150, top: 150 }));
      }
    }

    let header = modal.querySelector('#dc-addons-modal-header');
    let content = modal.querySelector('#dc-addons-modal-content');

    if (!header || !content) {
      modal.innerHTML = '';

      header = document.createElement('div');
      header.id = 'dc-addons-modal-header';
      Object.assign(header.style, {
        cursor: 'move',
        padding: '6px 10px',
        backgroundColor: '#222',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        userSelect: 'none'
      });

      const titleSpan = document.createElement('span');
      titleSpan.textContent = 'DeepCo Addons';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      Object.assign(closeBtn.style, {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        fontSize: '16px',
        cursor: 'pointer',
        padding: '0 4px'
      });
      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        localStorage.setItem(ADDONS_MODAL_OPEN_KEY, 'false');
      });

      header.appendChild(titleSpan);
      header.appendChild(closeBtn);

      content = document.createElement('div');
      content.id = 'dc-addons-modal-content';
      Object.assign(content.style, {
        padding: '8px',
        maxHeight: '400px',
        overflowY: 'auto'
      });

      modal.appendChild(header);
      modal.appendChild(content);

      makeModalDraggableLegacy(modal, header);
      setupAddonsDragAndDrop(content);
    } else if (!addonsDragSetupDone) {
      setupAddonsDragAndDrop(content);
    }

    let isOpen = localStorage.getItem(ADDONS_MODAL_OPEN_KEY);
    if (isOpen === null) isOpen = 'false';
    modal.style.display = isOpen === 'true' ? 'block' : 'none';

    renderAddonsModalContent();
  }

  function makeModalDraggableLegacy(modal, handle) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      DeepCoCore.ui.bringToFront(modal);
      const rect = modal.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const left = startLeft + dx;
      const top = startTop + dy;
      modal.style.left = left + 'px';
      modal.style.top = top + 'px';
      localStorage.setItem(ADDONS_MODAL_POS_KEY, JSON.stringify({ left, top }));
    });

    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  function setupAddonsDragAndDrop(content) {
    if (addonsDragSetupDone) return;
    addonsDragSetupDone = true;

    content.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = content.querySelector('.dc-addon-dragging');
      if (!dragging) return;

      const afterElement = getDragAfterElement(content, e.clientY);
      if (afterElement == null) content.appendChild(dragging);
      else content.insertBefore(dragging, afterElement);
    });

    content.addEventListener('drop', (e) => {
      e.preventDefault();
      const entries = Array.from(content.querySelectorAll('.dc-addon-entry'));
      addonOrder = entries.map(div => div.dataset.addonId).filter(Boolean);
      saveAddonOrder();
    });
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.dc-addon-entry:not(.dc-addon-dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const child of draggableElements) {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
    }
    return closest.element;
  }

  function renderAddonsModalContent() {
    const modal = document.getElementById('dc-addons-modal');
    if (!modal) return;
    const content = modal.querySelector('#dc-addons-modal-content');
    if (!content) return;

    content.innerHTML = '';

    if (addonOrder.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No addons registered yet.';
      p.style.fontSize = '0.9rem';
      content.appendChild(p);
      return;
    }

    addonOrder.forEach((id) => {
      const addon = addons[id];
      if (!addon) return;

      const row = document.createElement('div');
      row.className = 'dc-addon-entry';
      row.dataset.addonId = addon.id;
      row.draggable = true;

      row.addEventListener('dragstart', function (e) {
        if (e.target.closest('button, input, select, label')) {
          e.preventDefault();
          return;
        }
        this.classList.add('dc-addon-dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });

      row.addEventListener('dragend', function () {
        this.classList.remove('dc-addon-dragging');
      });

      const header = document.createElement('div');
      header.className = 'dc-addon-header';

      const left = document.createElement('div');
      left.className = 'dc-addon-header-left';

      const nameEl = document.createElement('div');
      nameEl.className = 'dc-addon-name';
      nameEl.textContent = addon.name || id;

      const descEl = document.createElement('div');
      descEl.className = 'dc-addon-desc';
      descEl.textContent = addon.description || '';

      left.appendChild(nameEl);
      if (addon.description) left.appendChild(descEl);

      const right = document.createElement('div');
      right.className = 'dc-addon-header-right';

      header.appendChild(left);
      header.appendChild(right);
      row.appendChild(header);

      const controlsContainer = document.createElement('div');
      controlsContainer.className = 'dc-addon-controls';

      if (addon.ui && Array.isArray(addon.ui.controls) && addon.ui.controls.length > 0) {
        addon.ui.controls.forEach((ctrl) => {
          const ctrlEl = renderAddonControl(addon, ctrl);
          if (ctrlEl) {
            const line = document.createElement('div');
            line.className = 'dc-addon-control-row';
            line.appendChild(ctrlEl);
            controlsContainer.appendChild(line);
          }
        });

        if (!addon.ui.hideDefaultEnable) {
          const basic = renderBasicEnableToggle(addon);
          if (basic) {
            const line = document.createElement('div');
            line.className = 'dc-addon-control-row';
            line.appendChild(basic);
            controlsContainer.appendChild(line);
          }
        }
      } else {
        const basic = renderBasicEnableToggle(addon);
        if (basic) {
          const line = document.createElement('div');
          line.className = 'dc-addon-control-row';
          line.appendChild(basic);
          controlsContainer.appendChild(line);
          controlsContainer.appendChild(line);
        }
      }

      if (controlsContainer.childNodes.length > 0) row.appendChild(controlsContainer);
      content.appendChild(row);
    });
  }

  function renderBasicEnableToggle(addon) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '4px';

    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '4px';
    label.style.fontSize = '0.8rem';
    label.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!addon.enabled;

    const lblText = document.createElement('span');
    lblText.textContent = addon.enabled ? 'Enabled' : 'Disabled';

    checkbox.addEventListener('change', () => {
      const newState = checkbox.checked;
      addon.enabled = newState;
      localStorage.setItem(ADDON_STATE_PREFIX + addon.id, newState ? 'true' : 'false');
      try {
        if (newState && addon.enable) addon.enable();
        if (!newState && addon.disable) addon.disable();
      } catch (e) {
        console.error('[DeepCo Core] Error toggling addon', addon.id, e);
      }
      lblText.textContent = newState ? 'Enabled' : 'Disabled';
    });

    label.appendChild(checkbox);
    label.appendChild(lblText);

    container.appendChild(label);
    return container;
  }

  function renderAddonControl(addon, ctrl) {
    const type = ctrl.type;

    if (type === 'button' || type === 'toggle') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-xs';
      btn.textContent = ctrl.label || (type === 'toggle' ? 'Toggle' : 'Action');
      btn.style.padding = '2px 6px';

      btn.addEventListener('click', () => {
        if (ctrl.action === 'event' && ctrl.eventName) {
          unsafeWindow.dispatchEvent(new CustomEvent(ctrl.eventName));
        }
        if (typeof ctrl.onClick === 'function') {
          try { ctrl.onClick(); }
          catch (e) { console.error('[DeepCo Core] ctrl.onClick error for addon', addon.id, e); }
        }
      });

      return btn;
    }

    if (type === 'checkbox' && ctrl.key) {
      const container = document.createElement('label');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '4px';
      container.style.fontSize = '0.8rem';
      container.style.cursor = 'pointer';

      const defaultVal = !!ctrl.default;
      const value = DeepCoCore.getAddonConfig(addon.id, ctrl.key, defaultVal);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!value;

      const span = document.createElement('span');
      span.textContent = ctrl.label || ctrl.key;

      checkbox.addEventListener('change', () => {
        const newVal = checkbox.checked;
        DeepCoCore.setAddonConfig(addon.id, ctrl.key, newVal);

        if (ctrl.action === 'event' && ctrl.eventName) {
          unsafeWindow.dispatchEvent(new CustomEvent(ctrl.eventName, { detail: { value: newVal } }));
        }
      });

      container.appendChild(checkbox);
      container.appendChild(span);
      return container;
    }

    if (type === 'dropdown' && ctrl.key && Array.isArray(ctrl.options) && ctrl.options.length > 0) {
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '4px';
      container.style.fontSize = '0.8rem';

      if (ctrl.label) {
        const label = document.createElement('span');
        label.textContent = ctrl.label;
        container.appendChild(label);
      }

      const select = document.createElement('select');
      select.style.fontSize = '0.8rem';

      ctrl.options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        select.appendChild(o);
      });

      const defaultValue = ctrl.defaultValue ?? ctrl.options[0].value;
      const currentVal = DeepCoCore.getAddonConfig(addon.id, ctrl.key, defaultValue);
      select.value = currentVal;

      select.addEventListener('change', () => {
        const newVal = select.value;
        DeepCoCore.setAddonConfig(addon.id, ctrl.key, newVal);

        if (ctrl.action === 'event' && ctrl.eventName) {
          unsafeWindow.dispatchEvent(new CustomEvent(ctrl.eventName, { detail: { value: newVal } }));
        }
      });

      container.appendChild(select);
      return container;
    }

    return null;
  }

  function loadAddonOrder() {
    const raw = localStorage.getItem(ADDON_ORDER_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveAddonOrder() {
    localStorage.setItem(ADDON_ORDER_KEY, JSON.stringify(addonOrder));
  }

  function DcMessageObserver() {
    try { dcMessageObserver?.disconnect?.(); } catch {}
    dcMessageObserver = new MutationObserver((mutationsList) => {
      let saw = false;
      let lastHtml = '';
      for (const mutation of mutationsList) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const html = node.innerHTML?.trim?.() || '';
          if (html.includes('[DC]')) {
            saw = true;
            lastHtml = html;
          }
        }
      }
      if (saw) logStats(lastHtml);
    });

    if (document.body) dcMessageObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function logStats(flashHtmlMaybe) {
    if (!isOnDigPage()) return;

    const timestamp = Date.now();
    const tileCount = getTileCount();
    const rc = getRCCount();
    const level = getLevel();
    const dc = getDCCount();
    const dcIncome = getDCIncomeFromFlashHtml(flashHtmlMaybe) || 0;
    const rating = getProcessingRating();
    const deptTag = getDeptTag();

    const row = [timestamp, tileCount, rc, level, dc, dcIncome, rating, deptTag];

    db.push(row);
    await GM.setValue(STORAGE_KEY, db);

    const index = db.length - 1;
    unsafeWindow.dispatchEvent(new CustomEvent('DeepCo:log', { detail: { row: row.slice(), index } }));
  }

  function signalCoreReady() {
    if (coreReady) return;
    coreReady = true;

    injectAddonsUiCss();

    unsafeWindow.dispatchEvent(new CustomEvent('DeepCo:coreReady', { detail: DeepCoCore }));
    unsafeWindow.dispatchEvent(new CustomEvent('DeepCo:ready', { detail: { db: DeepCoCore.getDb() } }));

    DeepCoCore.log('DeepCo Core', `Ready, rows: ${db.length}`, 'info');

    DcMessageObserver();
    startAddonsUiHeartbeat();
    ensureAddonsButtonAndModal();
  }

  injectAddonsUiCss();
  signalCoreReady();
})();
