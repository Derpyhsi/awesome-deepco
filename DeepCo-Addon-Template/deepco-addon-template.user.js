// ==UserScript==
// @name         DeepCo Addon Template
// @version      v1
// @description  Template for DeepCoCore
// @author       You
// @match        https://*.deepco.app/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepco.app
// @license      MIT
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ============================
  // CUSTOMIZE ME (required)
  // ============================
  const ADDON_ID = 'myNewAddonId';
  const ADDON_NAME = 'My New Addon';
  const ADDON_DESC = 'Describe what this addon does.';
  const DEFAULT_ENABLED = true;

  // If true, addon will destroy UI on non-/dig pages (but still loads everywhere).
  const RUN_ONLY_ON_DIG = false;

  const ENABLE_GLOBAL_LAUNCHER = true;

  // ============================
  // Core config keys (edit/add)
  // ============================
  const CFG_OPEN = 'open';
  const CFG_X = 'x';
  const CFG_Y = 'y';
  const CFG_W = 'w';
  const CFG_H = 'h';

  // Example custom config
  const CFG_EXAMPLE_BOOL = 'exampleBool';
  const CFG_EXAMPLE_MODE = 'exampleMode'; // e.g. "A" | "B"

  // ============================
  // UI IDs (unique per addon)
  // ============================
  const MODAL_ID = `dc-${ADDON_ID}-modal`;
  const HEADER_ID = `dc-${ADDON_ID}-header`;
  const RESIZE_ID = `dc-${ADDON_ID}-resize`;
  const BODY_ID = `dc-${ADDON_ID}-body`;
  const LAUNCHER_ID = `dc-${ADDON_ID}-launcher`;

  let core = null;
  let addonEnabled = false;
  let modalEl = null;
  let launcherEl = null;
  let unsubTurbo = null;
  let unsubDigEnter = null;
  let unsubDigLeave = null;

  // ============================
  // Helpers
  // ============================
  function log(msg, level = 'info') {
    if (core?.log) core.log(ADDON_ID, msg, level);
    else console.log(`[${ADDON_ID}]`, msg);
  }

  function getCfg(key, defVal) {
    return core?.getAddonConfig ? core.getAddonConfig(ADDON_ID, key, defVal) : defVal;
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
  // Global launcher button (all pages)
  // ============================
  function ensureLauncher() {
    if (!ENABLE_GLOBAL_LAUNCHER) return;
    if (launcherEl) return;

    launcherEl = document.createElement('button');
    launcherEl.id = LAUNCHER_ID;
    launcherEl.textContent = ADDON_NAME;
    launcherEl.type = 'button';

    Object.assign(launcherEl.style, {
      position: 'fixed',
      right: '14px',
      bottom: '14px',
      zIndex: '999999850',
      padding: '6px 10px',
      borderRadius: '999px',
      border: '1px solid #333',
      background: 'rgba(20,20,28,0.92)',
      color: '#f8f8ff',
      fontSize: '12px',
      cursor: 'pointer',
      boxShadow: '0 10px 25px rgba(0,0,0,0.35)',
      userSelect: 'none'
    });

    launcherEl.addEventListener('click', () => {
      if (!addonEnabled) return;
      if (!shouldRunNow()) return;

      ensureModal();
      const visible = modalEl && modalEl.style.display !== 'none';
      toggleModal(!visible);
    });

    document.body.appendChild(launcherEl);

    launcherEl.dataset.deepcoModal = '1';
  }

  function destroyLauncher() {
    launcherEl?.remove();
    launcherEl = null;
  }

  // ============================
  // Modal setup
  // ============================
  function ensureModal() {
    if (modalEl) return;

    const defaultW = 520;
    const defaultH = 420;
    const w = getCfg(CFG_W, defaultW);
    const h = getCfg(CFG_H, defaultH);

    const defaultX = Math.max(20, window.innerWidth - (defaultW + 40));
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
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
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
        <div style="opacity:0.8;">Template addon loaded. Replace this UI with your own.</div>
      </div>

      <div id="${RESIZE_ID}" title="Resize" style="
        position:absolute;right:6px;bottom:6px;width:12px;height:12px;cursor:nwse-resize;opacity:0.65;
        border-right:2px solid rgba(255,255,255,0.35);border-bottom:2px solid rgba(255,255,255,0.35);border-radius:2px;
      "></div>
    `;

    document.body.appendChild(modalEl);

    modalEl.dataset.deepcoModal = '1';
    core?.ui?.registerModalElement?.(modalEl);

    modalEl.querySelector(`#${MODAL_ID}-close`)?.addEventListener('click', () => toggleModal(false));
    modalEl.querySelector(`#${MODAL_ID}-refresh`)?.addEventListener('click', () => refreshUI());

    const header = modalEl.querySelector(`#${HEADER_ID}`);
    const resizer = modalEl.querySelector(`#${RESIZE_ID}`);

    core?.ui?.makeDraggable?.({
      element: modalEl,
      handle: header,
      persist: { addonId: ADDON_ID, xKey: CFG_X, yKey: CFG_Y }
    });

    core?.ui?.makeResizable?.({
      element: modalEl,
      handle: resizer,
      minW: 340,
      minH: 240,
      persist: { addonId: ADDON_ID, wKey: CFG_W, hKey: CFG_H }
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
  // UI Rendering (CUSTOMIZE ME)
  // ============================
  function refreshUI() {
    if (!modalEl) return;

    const exampleBool = getCfg(CFG_EXAMPLE_BOOL, true);
    const exampleMode = getCfg(CFG_EXAMPLE_MODE, 'A');

    const body = modalEl.querySelector(`#${BODY_ID}`);
    if (!body) return;

    body.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div style="border:1px solid #2b2b35;border-radius:10px;padding:10px;min-width:220px;background:rgba(255,255,255,0.03);">
          <div style="font-weight:700;margin-bottom:6px;">Config Example</div>

          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="${MODAL_ID}-exampleBool" ${exampleBool ? 'checked' : ''}/>
            <span>Example bool</span>
          </label>

          <div style="margin-top:8px;">
            <div style="opacity:0.8;font-size:11px;margin-bottom:2px;">Example mode</div>
            <select id="${MODAL_ID}-exampleMode" class="form-select" style="font-size:12px;">
              <option value="A" ${exampleMode === 'A' ? 'selected' : ''}>A</option>
              <option value="B" ${exampleMode === 'B' ? 'selected' : ''}>B</option>
            </select>
          </div>
        </div>

        <div style="border:1px solid #2b2b35;border-radius:10px;padding:10px;min-width:220px;background:rgba(255,255,255,0.03);">
          <div style="font-weight:700;margin-bottom:6px;">Core Helpers Example</div>
          <div style="opacity:0.85;line-height:1.4;">
            On dig? <b>${isOnDig() ? 'Yes' : 'No'}</b><br/>
            TileCount: <b>${core?.utils?.getTileCount?.() ?? 'n/a'}</b><br/>
            RC: <b>${core?.utils?.getRCCount?.() ?? 'n/a'}</b><br/>
            DC: <b>${core?.utils?.getDCCount?.() ?? 'n/a'}</b>
          </div>
          <div style="margin-top:8px;opacity:0.65;font-size:11px;">
            RUN_ONLY_ON_DIG: <b>${RUN_ONLY_ON_DIG ? 'true' : 'false'}</b>
          </div>
        </div>
      </div>
    `;

    body.querySelector(`#${MODAL_ID}-exampleBool`)?.addEventListener('change', (e) => {
      setCfg(CFG_EXAMPLE_BOOL, !!e.target.checked);
      refreshUI();
    });

    body.querySelector(`#${MODAL_ID}-exampleMode`)?.addEventListener('change', (e) => {
      setCfg(CFG_EXAMPLE_MODE, e.target.value);
      refreshUI();
    });

    modalEl.querySelector(`#${MODAL_ID}-status`)?.replaceChildren(
      document.createTextNode(`Updated: ${new Date().toLocaleTimeString()}`)
    );
  }

  function onNav() {
    if (!addonEnabled) return;

    ensureLauncher();

    if (!shouldRunNow()) {
      destroyModal();
      return;
    }

    ensureModal();
    const shouldOpen = getCfg(CFG_OPEN, false);
    toggleModal(!!shouldOpen);
  }

  // ============================
  // Core registration
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
          { type: 'button', label: `Toggle ${ADDON_NAME}`, action: 'event', eventName: `DeepCo:${ADDON_ID}:toggleModal` }
        ]
      },

      onConfigChange: () => {
        if (!addonEnabled) return;
        if (modalEl && modalEl.style.display !== 'none') refreshUI();
      },

      enable: () => {
        addonEnabled = true;

        ensureLauncher();
        onNav();

        unsubTurbo = core.lifecycle?.onTurbo?.(() => onNav()) || null;
        unsubDigEnter = core.lifecycle?.onDigEnter?.(() => onNav()) || null;
        unsubDigLeave = core.lifecycle?.onDigLeave?.(() => onNav()) || null;

        log('Enabled');
      },

      disable: () => {
        addonEnabled = false;

        try { unsubTurbo?.(); } catch {}
        try { unsubDigEnter?.(); } catch {}
        try { unsubDigLeave?.(); } catch {}
        unsubTurbo = unsubDigEnter = unsubDigLeave = null;

        destroyModal();
        destroyLauncher();
        log('Disabled');
      }
    });

    window.addEventListener(`DeepCo:${ADDON_ID}:toggleModal`, () => {
      if (!addonEnabled) return;
      if (!shouldRunNow()) return;

      ensureLauncher();
      ensureModal();
      const visible = modalEl && modalEl.style.display !== 'none';
      toggleModal(!visible);
    });

    log('Registered with Core');
  }

  if (window.DeepCoCore) registerWithCore(window.DeepCoCore);
  window.addEventListener('DeepCo:coreReady', (e) => registerWithCore(e.detail));
})();
