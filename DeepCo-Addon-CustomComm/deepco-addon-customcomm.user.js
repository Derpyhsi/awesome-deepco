// ==UserScript==
// @name         DeepCo Custom Comm (Addon)
// @version      v.10
// @description  Custom Comm Terminal
// @author       diehardk0
// @match        https://*.deepco.app/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepco.app
// @license      MIT
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const ADDON_ID = 'customCommModal';
  const CFG_MODAL_X = 'modalX';
  const CFG_MODAL_Y = 'modalY';
  const CFG_MODAL_W = 'modalW';
  const CFG_MODAL_H = 'modalH';
  const CFG_MODAL_VISIBLE = 'modalVisible';
  const CFG_FM_X = 'friendsMgrX';
  const CFG_FM_Y = 'friendsMgrY';
  const CFG_FM_W = 'friendsMgrW';
  const CFG_FM_H = 'friendsMgrH';
  const CFG_FM_VISIBLE = 'friendsMgrVisible';
  const CFG_FRIENDS_MAP_V2 = 'friendsMapV2';
  const CFG_FRIENDS_LIST_V1 = 'friendsListV1';
  const FRIENDS_LS_FALLBACK_KEY = 'dcCustomCommFriendsMapV2';
  const MODAL_ID = 'dc-custom-comm-modal';
  const MODAL_HEADER_ID = 'dc-custom-comm-modal-header';
  const MODAL_BODY_ID = 'dc-custom-comm-modal-body';
  const MODAL_INPUT_ID = 'dc-custom-comm-input';
  const MODAL_SEND_ID = 'dc-custom-comm-send';
  const MODAL_RESIZE_ID = 'dc-custom-comm-resize';
  const FM_ID = 'dc-custom-comm-friendsmgr';
  const FM_HEADER_ID = 'dc-custom-comm-friendsmgr-header';
  const FM_RESIZE_ID = 'dc-custom-comm-friendsmgr-resize';
  const HISTORY_KEY = 'dcCustomCommHistoryV1';
  const MAX_HISTORY = 1000;
  const DEFAULT_FRIEND_NAME_COLOR = '#3aa0ff';
  const DEFAULT_FRIEND_MSG_COLOR = '#35ff6a';

  let core = null;
  let addonEnabled = false;
  let unsubTurbo = null;
  let chatObserver = null;
  let chatObserverHooked = false;
  let lastChatFrame = null;
  let modalVisible = true;
  let friendsMgrVisible = false;
  let friendsMap = Object.create(null);

  const messageLog = [];
  const messageKeySet = new Set();

  const SLASH_COMMANDS = [
    { command: "/process", description: "Main processing area", path: "/dig" },
    { command: "/upgrades", description: "Upgrade systems", path: "/upgrades" },
    { command: "/performance", description: "Performance leaderboards", path: "/legends" },
    { command: "/recursion", description: "Recursion interface", path: "/recursion" },
    { command: "/settings", description: "System settings", path: "/settings" },
    { command: "/shop", description: "DeepCo™ shop", path: "/shop" },
    { command: "/achievements", description: "Achievement system", path: "/achievements" },
    { command: "/departments", description: "Department management", path: "/departments" },
    { command: "/messages", description: "Email system", path: "/worker_emails" },
    { command: "/terminal", description: "Access Terminal (TUI)", path: "/terminal" },
    { command: "/faq", description: "Frequently asked questions", path: "/faq" },
    { command: "/terms", description: "Terms of service", path: "/terms" },
    { command: "/syslog", description: "System update log", path: "/dev_log_entries" },
    { command: "/idle", description: "Async Division", path: "/idle/initiate" }
  ];

  function getCfg(key, defVal) {
    if (!core) return defVal;
    return core.getAddonConfig(ADDON_ID, key, defVal);
  }
  function setCfg(key, val) {
    if (!core) return;
    core.setAddonConfig(ADDON_ID, key, val);
  }
  function log(msg, level = 'info') {
    if (core?.log) core.log(ADDON_ID, msg, level);
    else console.log('[CustomCommModal]', msg);
  }

  function normName(s) {
    return String(s || '').trim().toLowerCase();
  }

  function clampHexColor(s, fallback) {
    const v = String(s || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    return fallback;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeParseJson(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function getFMap() {
    const raw = localStorage.getItem(FRIENDS_LS_FALLBACK_KEY);
    if (!raw) return null;
    const obj = safeParseJson(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    return null;
  }

  function saveFMap(mapObj) {
    try { localStorage.setItem(FRIENDS_LS_FALLBACK_KEY, JSON.stringify(mapObj)); } catch (e) {}
  }

  function normMapInput(mapObj) {
    const out = Object.create(null);
    if (!mapObj || typeof mapObj !== 'object') return out;

    for (const [k, v] of Object.entries(mapObj)) {
      const key = normName(k);
      if (!key) continue;
      const name = String(v?.name ?? k).trim() || k;
      out[key] = {
        name,
        key,
        nameColor: clampHexColor(v?.nameColor, DEFAULT_FRIEND_NAME_COLOR),
        msgColor: clampHexColor(v?.msgColor, DEFAULT_FRIEND_MSG_COLOR)
      };
    }
    return out;
  }

  function migrateIfNeeded() {
    let map = null;

    if (core) {
      const cfgMap = getCfg(CFG_FRIENDS_MAP_V2, null);
      if (cfgMap && typeof cfgMap === 'object' && !Array.isArray(cfgMap)) {
        map = cfgMap;
      }
    }

    if (!map) {
      const fb = getFMap();
      if (fb) map = fb;
    }

    if (!map && core) {
      const v1 = getCfg(CFG_FRIENDS_LIST_V1, null);
      if (Array.isArray(v1)) {
        const converted = Object.create(null);
        v1.map(x => String(x)).filter(Boolean).forEach(name => {
          const key = normName(name);
          if (!key) return;
          converted[key] = { name: name.trim(), nameColor: DEFAULT_FRIEND_NAME_COLOR, msgColor: DEFAULT_FRIEND_MSG_COLOR };
        });
        map = converted;
      }
    }

    return normMapInput(map);
  }

  function serializeFMap() {
    const out = Object.create(null);
    for (const [k, f] of Object.entries(friendsMap)) {
      out[k] = {
        name: f.name,
        nameColor: f.nameColor,
        msgColor: f.msgColor
      };
    }
    return out;
  }

  function loadFriends() {
    friendsMap = migrateIfNeeded();
    saveFMap(serializeFMap());
  }

  function persistFriends() {
    const payload = serializeFMap();
    saveFMap(payload);

    if (!core) return;

    const current = getCfg(CFG_FRIENDS_MAP_V2, null);
    const currObj = (current && typeof current === 'object' && !Array.isArray(current)) ? current : null;

    const a = JSON.stringify(currObj || {});
    const b = JSON.stringify(payload);
    if (a !== b) setCfg(CFG_FRIENDS_MAP_V2, payload);
  }

  function getFriend(username) {
    const key = normName(username);
    if (!key) return null;
    return friendsMap[key] || null;
  }

  function addFriend(nameRaw, opts = {}) {
    const raw = String(nameRaw || '').trim();
    const key = normName(raw);
    if (!key) return { ok: false, msg: 'Usage: /friend <name>' };

    if (friendsMap[key]) return { ok: false, msg: `${raw} is already in your friends list.` };

    friendsMap[key] = {
      name: raw,
      key,
      nameColor: clampHexColor(opts.nameColor, DEFAULT_FRIEND_NAME_COLOR),
      msgColor: clampHexColor(opts.msgColor, DEFAULT_FRIEND_MSG_COLOR)
    };

    persistFriends();
    return { ok: true, msg: `Added friend: ${raw}` };
  }

  function removeFriend(nameRaw) {
    const raw = String(nameRaw || '').trim();
    const key = normName(raw);
    if (!key) return { ok: false, msg: 'Usage: /unfriend <name>' };

    if (!friendsMap[key]) return { ok: false, msg: `${raw} was not in your friends list.` };

    delete friendsMap[key];
    persistFriends();
    return { ok: true, msg: `Removed friend: ${raw}` };
  }

  function updateFriend(keyLower, patch) {
    const k = normName(keyLower);
    if (!k || !friendsMap[k]) return false;

    const f = friendsMap[k];
    if (patch.name != null) f.name = String(patch.name).trim() || f.name;
    if (patch.nameColor != null) f.nameColor = clampHexColor(patch.nameColor, f.nameColor);
    if (patch.msgColor != null) f.msgColor = clampHexColor(patch.msgColor, f.msgColor);

    persistFriends();
    return true;
  }

  function listFriendsText() {
    const keys = Object.keys(friendsMap);
    if (!keys.length) return 'Friends: (none)\nUse: /friend <name> or open Friends Manager.';
    const lines = keys
      .map(k => friendsMap[k].name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return `Friends (${lines.length}):\n` + lines.map(n => `- ${n}`).join('\n');
  }

  loadFriends();

  function makeKey(msg) {
    return String(msg?.id || '') || `${msg.time || ''}||${msg.username || ''}||${msg.message || ''}`;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;

      arr.forEach(m => {
        const msg = {
          username: m.username || 'SYSTEM',
          time: m.time || '',
          message: m.message || ''
        };
        const key = makeKey(msg);
        if (!messageKeySet.has(key)) {
          messageKeySet.add(key);
          messageLog.push(msg);
        }
      });
    } catch (e) {
      console.error('[CustomCommModal] Failed to load history:', e);
    }
  }

  function saveHistory() {
    try {
      const filtered = messageLog.filter(m => m.username !== 'LOCAL');
      const trimmed = filtered.slice(-MAX_HISTORY);
      const payload = trimmed.map(m => ({ username: m.username, time: m.time, message: m.message }));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('[CustomCommModal] Failed to save history:', e);
    }
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
  }

  loadHistory();

  function getChatFrame() {
    return document.querySelector('turbo-frame#chat') || null;
  }

  function getChatRoot() {
    return document.querySelector('[data-controller~="chat"]') || null;
  }

  function getChatUsernameColor() {
    const frame = getChatFrame();
    if (!frame) return null;
    const candidate =
      frame.querySelector('.text-primary, .font-semibold, .chat-header span, .text-accent');
    if (!candidate) return null;
    return getComputedStyle(candidate).color;
  }

  function ensureCommModal() {
    if (!addonEnabled) return;

    if (core) {
      modalVisible = !!getCfg(CFG_MODAL_VISIBLE, true);
      friendsMgrVisible = !!getCfg(CFG_FM_VISIBLE, false);
    }

    const chatFrame = getChatFrame();

    if (!chatFrame) {
      if (modalVisible) ensureCommModalExist();
      if (friendsMgrVisible) ensureFriendsManagerExists();
      return;
    }

    hideChatcard(chatFrame);

    if (modalVisible) {
      ensureCommModalExist();
      syncMessagesFromOriginal();
      hookChatObserver(chatFrame);
    } else {
      const modal = document.getElementById(MODAL_ID);
      if (modal) modal.style.display = 'none';
    }

    if (friendsMgrVisible) ensureFriendsManagerExists();
    else {
      const fm = document.getElementById(FM_ID);
      if (fm) fm.style.display = 'none';
    }
  }

  function hideChatcard(chatFrame) {
    const chatCard = chatFrame.querySelector('.card');
    if (!chatCard) return;
    if (!chatCard.__dcCustomCommHidden) {
      chatCard.style.display = 'none';
      chatCard.__dcCustomCommHidden = true;
    }
  }

  function restoreChatcard() {
    const chatFrame = getChatFrame();
    if (!chatFrame) return;
    const chatCard = chatFrame.querySelector('.card');
    if (!chatCard) return;
    if (chatCard.__dcCustomCommHidden) {
      chatCard.style.display = '';
      delete chatCard.__dcCustomCommHidden;
    }
  }

  function hookChatObserver(chatFrame) {
    if (!chatFrame) return;

    if (lastChatFrame && chatFrame !== lastChatFrame) {
      unhookChatObserver();
    }

    if (chatObserverHooked && chatObserver) return;

    lastChatFrame = chatFrame;

    chatObserver = new MutationObserver(() => {
      if (hookChatObserver.__raf) return;
      hookChatObserver.__raf = requestAnimationFrame(() => {
        hookChatObserver.__raf = null;
        if (!addonEnabled || !modalVisible) return;
        syncMessagesFromOriginal();
      });
    });

    chatObserver.observe(chatFrame, { childList: true, subtree: true, characterData: true });
    chatObserverHooked = true;
  }
  hookChatObserver.__raf = null;

  function unhookChatObserver() {
    if (chatObserver) {
      try { chatObserver.disconnect(); } catch (e) {}
    }
    chatObserver = null;
    chatObserverHooked = false;
    lastChatFrame = null;
    if (hookChatObserver.__raf) {
      cancelAnimationFrame(hookChatObserver.__raf);
      hookChatObserver.__raf = null;
    }
  }

  const timeRegex = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
  const idRegex = /^\d{6,}$/;

  function buildMessages(lines) {
    const messages = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (
        idRegex.test(line) &&
        i + 2 < lines.length &&
        timeRegex.test(lines[i + 1]) &&
        !idRegex.test(lines[i + 2])
      ) {
        const time = lines[i + 1];
        const user = lines[i + 2];

        let j = i + 3;
        const msgLines = [];
        while (j < lines.length && !idRegex.test(lines[j])) {
          msgLines.push(lines[j]);
          j++;
        }

        const messageText = msgLines.join('\n').replace(/^>\s?/gm, '').trim();
        if (messageText) messages.push({ username: user, time, message: messageText });

        i = j;
        continue;
      }

      if (line.startsWith('>')) {
        const msgLines = [];
        let j = i;
        while (j < lines.length && lines[j].startsWith('>')) {
          msgLines.push(lines[j]);
          j++;
        }

        const messageText = msgLines.join('\n').replace(/^>\s?/gm, '').trim();
        if (messageText) messages.push({ username: 'SYSTEM', time: '', message: messageText });

        i = j;
        continue;
      }

      messages.push({ username: 'SYSTEM', time: '', message: line });
      i++;
    }

    messages.reverse();
    return messages;
  }

  function parseChatMessages(chatFrame) {
  const out = [];
  if (!chatFrame) return out;

  const list = chatFrame.querySelector('#chat-messages') || chatFrame;
  const nodes = list.querySelectorAll('[data-role="chat-message"]');
  if (!nodes || !nodes.length) return out;

  nodes.forEach(node => {
    try {
      const isSystem = String(node.getAttribute('data-is-system') || '') === 'true';

      const rawId = (node.getAttribute('id') || node.id || '').trim();
      const id = rawId ? rawId.replace(/^"+|"+$/g, '') : '';

      const tsNode = node.querySelector('[data-controller="local-time"][data-local-time-format-value="time"]');
      const timeText = (tsNode?.textContent || '').trim();

      let username = 'SYSTEM';
      let usernameColor = null; // Add this

      if (!isSystem) {
        const link = node.querySelector('a.worker-name-link');
        if (link) {
          const spans = Array.from(link.querySelectorAll('span')).filter(s => !s.classList.contains('official-badge'));
          const candidate = spans.length ? spans[spans.length - 1] : link;
          username = (candidate.textContent || '').trim() || 'SYSTEM';
          // Capture the color from computed style
          usernameColor = getComputedStyle(candidate).color;
        } else {
          const anyUser = node.querySelector('.worker-name-link, .font-semibold, [data-worker-id]');
          if (anyUser) {
            username = (anyUser.textContent || '').trim() || 'SYSTEM';
            usernameColor = getComputedStyle(anyUser).color;
          }
        }
      }

      const msgNode = node.querySelector('.break-words') || node.querySelector('.leading-relaxed');
      const message = (msgNode?.textContent || '').trim();

      if (!message) return;

      out.push({
        id: id || String(node.getAttribute('data-message-timestamp') || '').replace(/^"+|"+$/g, ''),
        username,
        usernameColor, // Add this
        time: timeText || '',
        message
      });
    } catch (e) {}
  });

  out.reverse();
  return out;
}

  function ensureBodyLayers(modalBody) {
    if (!modalBody) return { remote: null, local: null };
    let remote = modalBody.querySelector('.dc-comm-remote');
    let local = modalBody.querySelector('.dc-comm-local');

    if (!remote) {
      remote = document.createElement('div');
      remote.className = 'dc-comm-remote';
      modalBody.appendChild(remote);
    }
    if (!local) {
      local = document.createElement('div');
      local.className = 'dc-comm-local';
      modalBody.appendChild(local);
    }
    return { remote, local };
  }

  function syncMessagesFromOriginal() {
    const modalBody = document.getElementById(MODAL_BODY_ID);
    if (!modalBody) return;

    const chatFrame = getChatFrame();
    if (!chatFrame) {
      renderMessage(modalBody);
      return;
    }

    const modal = document.getElementById(MODAL_ID);
    if (modal) {
        const userColor = getChatUsernameColor();
        if (userColor) {
            modal.style.setProperty('--dc-comm-user-color', userColor);
        }
    }

    const oldScrollTop = modalBody.scrollTop;
    const maxScroll = modalBody.scrollHeight - modalBody.clientHeight;
    const nearBottom = maxScroll <= 0 ? true : (maxScroll - oldScrollTop) < 40;

    const domMsgs = parseChatMessages(chatFrame);

    let snapshotMessages = domMsgs;
    if (!snapshotMessages || snapshotMessages.length === 0) {
      const clone = chatFrame.cloneNode(true);
      const cardBody = clone.querySelector('.card-body') || clone;

      cardBody.querySelectorAll(
        '[data-chat-target="form"],[data-chat-target="input"],[data-chat-target="suggestions"],form,input,textarea'
      ).forEach(el => el.remove());

      const fullText = (cardBody.innerText || '').trim();
      const rawLines = [];
      if (fullText) {
        fullText.split('\n').forEach(l => {
          const t = l.trim();
          if (t) rawLines.push(t);
        });
      }

      const blacklist = new Set(['Unpin from Layout', '[UNPIN]', 'Comm Terminal']);
      const lines = rawLines.filter(l => !blacklist.has(l));
      snapshotMessages = lines.length > 0 ? buildMessages(lines) : [];
    }

    let added = 0;
    snapshotMessages.forEach(msg => {
    const key = makeKey(msg);
    if (!messageKeySet.has(key)) {
      messageKeySet.add(key);
      messageLog.push({
        id: msg.id || undefined,
        username: msg.username || 'SYSTEM',
        usernameColor: msg.usernameColor || null, // ← ADD THIS LINE
        time: msg.time || '',
        message: msg.message || ''
      });
      added++;
    }
  });

    if (added > 0) saveHistory();
    renderMessage(modalBody, nearBottom, oldScrollTop);
  }

  function renderMessage(modalBody, nearBottomOverride, oldScrollTopOverride) {
    const { remote } = ensureBodyLayers(modalBody);
    if (!remote) return;

    const oldScrollTop = oldScrollTopOverride ?? modalBody.scrollTop;
    const maxScroll = modalBody.scrollHeight - modalBody.clientHeight;
    const nearBottom =
      typeof nearBottomOverride === 'boolean'
        ? nearBottomOverride
        : (maxScroll <= 0 ? true : (maxScroll - oldScrollTop) < 40);

    // Get current operator name
    const operName = core?.getOperName?.() || '';
    const operNameLower = normName(operName);

    remote.innerHTML = '';
    if (messageLog.length === 0) {
      const p = document.createElement('div');
      p.className = 'dc-comm-empty';
      p.textContent = 'No messages yet.';
      remote.appendChild(p);
    } else {
      messageLog.forEach(msg => {
  const wrapper = document.createElement('div');
  const isSystem = (msg.username === 'SYSTEM' || msg.username === 'LOCAL');
  const friend = !isSystem ? getFriend(msg.username) : null;

  // Check if message mentions the current operator
  const isMention = operNameLower && msg.message.toLowerCase().includes(`@${operNameLower}`);

  wrapper.className =
    `dc-comm-line` +
    (isSystem ? ' dc-comm-system' : '') +
    (friend ? ' dc-comm-friend' : '') +
    (isMention ? ' dc-comm-mention' : '');

  // Set color CSS variable - friend color takes priority, then captured color
  if (friend) {
    wrapper.style.setProperty('--dc-user-name-color', friend.nameColor);
    wrapper.style.setProperty('--dc-friend-msg', friend.msgColor);
  } else if (msg.usernameColor) {
    wrapper.style.setProperty('--dc-user-name-color', msg.usernameColor);
  }

  wrapper.innerHTML = `
    <div class="dc-comm-meta">
      <span class="dc-comm-user">${escapeHtml(msg.username)}</span>
      <span class="dc-comm-time">${escapeHtml(msg.time)}</span>
      <span class="dc-comm-sep">&gt;</span>
    </div>
    <div class="dc-comm-text">${escapeHtml(msg.message)}</div>
  `;
  remote.appendChild(wrapper);
});
    }

    modalBody.scrollTop = nearBottom ? modalBody.scrollHeight : oldScrollTop;
  }

  function ensureCommModalExist() {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = MODAL_ID;

      const defaultW = 440;
      const defaultH = 320;
      const defaultX = window.innerWidth - (defaultW + 40);
      const defaultY = window.innerHeight - (defaultH + 40);

      const savedX = getCfg(CFG_MODAL_X, defaultX);
      const savedY = getCfg(CFG_MODAL_Y, defaultY);
      const savedW = getCfg(CFG_MODAL_W, defaultW);
      const savedH = getCfg(CFG_MODAL_H, defaultH);

      Object.assign(modal.style, {
        position: 'fixed',
        left: savedX + 'px',
        top: savedY + 'px',
        width: savedW + 'px',
        height: savedH + 'px',
        background: 'rgba(8, 8, 12, 0.98)',
        color: '#f8f8ff',
        border: '1px solid #444',
        borderRadius: '8px',
        boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
        zIndex: '999999999',
        display: 'block',
        boxSizing: 'border-box',
        fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
      });

      modal.innerHTML = `
        <div id="${MODAL_HEADER_ID}" class="dc-comm-header">
          <span class="dc-comm-title">Comm Terminal</span>
          <button type="button" class="dc-comm-btn dc-comm-friendsbtn" title="Friends Manager">👥</button>
          <button type="button" class="dc-comm-close" title="Close">×</button>
        </div>
        <div id="${MODAL_BODY_ID}" class="dc-comm-body">
          <div class="dc-comm-remote"></div>
          <div class="dc-comm-local"></div>
        </div>
        <div class="dc-comm-input-row">
          <input id="${MODAL_INPUT_ID}" type="text" class="dc-comm-input" placeholder="Type a message or /command">
          <button id="${MODAL_SEND_ID}" type="button" class="dc-comm-send">Send</button>
        </div>
        <div id="${MODAL_RESIZE_ID}" class="dc-comm-resize" title="Resize"></div>
      `;

      document.body.appendChild(modal);

      modal.dataset.deepcoModal = '1';
      core?.ui?.registerModalElement?.(modal, { bringToFrontOnRegister: true });

      const header = document.getElementById(MODAL_HEADER_ID);
      const closeBtn = modal.querySelector('.dc-comm-close');
      const friendsBtn = modal.querySelector('.dc-comm-friendsbtn');
      const sendBtn = document.getElementById(MODAL_SEND_ID);
      const inputEl = document.getElementById(MODAL_INPUT_ID);
      const modalBody = document.getElementById(MODAL_BODY_ID);
      const resizeEl = document.getElementById(MODAL_RESIZE_ID);

      closeBtn.addEventListener('click', () => {
        modalVisible = false;
        if (core) setCfg(CFG_MODAL_VISIBLE, false);
        modal.style.display = 'none';
      });

      friendsBtn.addEventListener('click', () => {
        toggleFriendsManager();
      });

      makeModalDraggable(modal, header, () => {
        const rect = modal.getBoundingClientRect();
        if (core) {
          setCfg(CFG_MODAL_X, rect.left);
          setCfg(CFG_MODAL_Y, rect.top);
        }
      });

      makeModalResizable(modal, resizeEl, () => {
        const rect = modal.getBoundingClientRect();
        if (core) {
          setCfg(CFG_MODAL_W, Math.round(rect.width));
          setCfg(CFG_MODAL_H, Math.round(rect.height));
        }
      });

      sendBtn.addEventListener('click', () => sendMessageFromModal());
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendMessageFromModal();
        }
      });

      if (modalBody) {
        modalBody.addEventListener('click', (e) => {
          const userSpan = e.target.closest('.dc-comm-user');
          if (!userSpan) return;

          const username = userSpan.textContent.trim();
          if (!username) return;

          const mention = `@${username} `;
          const commInput = document.getElementById(MODAL_INPUT_ID);
          if (!commInput) return;

          if (!commInput.value || !commInput.value.trim()) commInput.value = mention;
          else if (!commInput.value.startsWith(mention)) commInput.value = mention + commInput.value;

          commInput.focus();
          const len = commInput.value.length;
          commInput.setSelectionRange(len, len);
        });
      }

      const userColor = getChatUsernameColor();
      if (userColor) modal.style.setProperty('--dc-comm-user-color', userColor);

      renderMessage(modalBody, true);
    } else {
      modal.style.display = 'block';
      ensureBodyLayers(document.getElementById(MODAL_BODY_ID));
    }
  }

  function toggleFriendsManager() {
    friendsMgrVisible = !friendsMgrVisible;
    if (core) setCfg(CFG_FM_VISIBLE, friendsMgrVisible);
    if (friendsMgrVisible) ensureFriendsManagerExists();
    else {
      const fm = document.getElementById(FM_ID);
      if (fm) fm.style.display = 'none';
    }
  }

  function ensureFriendsManagerExists() {
    let fm = document.getElementById(FM_ID);
    if (!fm) {
      fm = document.createElement('div');
      fm.id = FM_ID;

      const defaultW = 380;
      const defaultH = 360;
      const defaultX = Math.max(20, window.innerWidth - (defaultW + 520));
      const defaultY = 80;

      const savedX = getCfg(CFG_FM_X, defaultX);
      const savedY = getCfg(CFG_FM_Y, defaultY);
      const savedW = getCfg(CFG_FM_W, defaultW);
      const savedH = getCfg(CFG_FM_H, defaultH);

      Object.assign(fm.style, {
        position: 'fixed',
        left: savedX + 'px',
        top: savedY + 'px',
        width: savedW + 'px',
        height: savedH + 'px',
        background: 'rgba(10, 10, 16, 0.98)',
        color: '#f8f8ff',
        border: '1px solid #444',
        borderRadius: '10px',
        boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
        zIndex: '999999999',
        display: 'block',
        boxSizing: 'border-box',
        fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
      });

      fm.innerHTML = `
        <div id="${FM_HEADER_ID}" class="dc-fm-header">
          <span class="dc-fm-title">Friends Manager</span>
          <button type="button" class="dc-fm-close" title="Close">×</button>
        </div>

        <div class="dc-fm-addrow">
          <input type="text" class="dc-fm-addname" placeholder="Friend name (exact username)">
          <label class="dc-fm-colorlbl">Name <input type="color" class="dc-fm-addnamecolor" value="${DEFAULT_FRIEND_NAME_COLOR}"></label>
          <label class="dc-fm-colorlbl">Msg <input type="color" class="dc-fm-addmsgcolor" value="${DEFAULT_FRIEND_MSG_COLOR}"></label>
          <button type="button" class="dc-fm-addbtn">Add</button>
        </div>

        <div class="dc-fm-listwrap">
          <div class="dc-fm-list"></div>
        </div>

        <div class="dc-fm-foot">
          <button type="button" class="dc-fm-refresh">Refresh</button>
          <div class="dc-fm-hint">Tip: /friend &lt;name&gt; also works.</div>
        </div>

        <div id="${FM_RESIZE_ID}" class="dc-fm-resize" title="Resize"></div>
      `;

      document.body.appendChild(fm);

      const header = fm.querySelector(`#${FM_HEADER_ID}`);
      const closeBtn = fm.querySelector('.dc-fm-close');
      const addName = fm.querySelector('.dc-fm-addname');
      const addNameColor = fm.querySelector('.dc-fm-addnamecolor');
      const addMsgColor = fm.querySelector('.dc-fm-addmsgcolor');
      const addBtn = fm.querySelector('.dc-fm-addbtn');
      const listEl = fm.querySelector('.dc-fm-list');
      const refreshBtn = fm.querySelector('.dc-fm-refresh');
      const resizeEl = fm.querySelector(`#${FM_RESIZE_ID}`);

      closeBtn.addEventListener('click', () => {
        friendsMgrVisible = false;
        if (core) setCfg(CFG_FM_VISIBLE, false);
        fm.style.display = 'none';
      });

      addBtn.addEventListener('click', () => {
        const name = String(addName.value || '').trim();
        if (!name) return;
        const res = addFriend(name, { nameColor: addNameColor.value, msgColor: addMsgColor.value });
        addName.value = '';
        renderFriendsManagerList(listEl);
        rerenderCommIfOpen();
        toastLocal(res.msg);
      });

      addName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addBtn.click();
      });

      refreshBtn.addEventListener('click', () => {
        loadFriends();
        renderFriendsManagerList(listEl);
        rerenderCommIfOpen();
      });

      makeModalDraggable(fm, header, () => {
        const rect = fm.getBoundingClientRect();
        if (core) {
          setCfg(CFG_FM_X, rect.left);
          setCfg(CFG_FM_Y, rect.top);
        }
      });

      makeModalResizable(fm, resizeEl, () => {
        const rect = fm.getBoundingClientRect();
        if (core) {
          setCfg(CFG_FM_W, Math.round(rect.width));
          setCfg(CFG_FM_H, Math.round(rect.height));
        }
      });

      renderFriendsManagerList(listEl);
    } else {
      fm.style.display = 'block';
      const listEl = fm.querySelector('.dc-fm-list');
      if (listEl) renderFriendsManagerList(listEl);
    }
  }

  function renderFriendsManagerList(listEl) {
    if (!listEl) return;

    const keys = Object.keys(friendsMap).sort((a, b) => {
      const A = friendsMap[a]?.name || a;
      const B = friendsMap[b]?.name || b;
      return A.localeCompare(B, undefined, { sensitivity: 'base' });
    });

    if (!keys.length) {
      listEl.innerHTML = `<div class="dc-fm-empty">No friends yet.</div>`;
      return;
    }

    listEl.innerHTML = '';
    keys.forEach(k => {
      const f = friendsMap[k];

      const row = document.createElement('div');
      row.className = 'dc-fm-row';
      row.innerHTML = `
        <div class="dc-fm-name">
          <div class="dc-fm-nameText">${escapeHtml(f.name)}</div>
          <div class="dc-fm-key">${escapeHtml(k)}</div>
        </div>

        <div class="dc-fm-controls">
          <label class="dc-fm-colorlbl">Name
            <input type="color" class="dc-fm-nameColor" value="${escapeHtml(f.nameColor)}">
          </label>
          <label class="dc-fm-colorlbl">Msg
            <input type="color" class="dc-fm-msgColor" value="${escapeHtml(f.msgColor)}">
          </label>
          <button type="button" class="dc-fm-remove">Remove</button>
        </div>
      `;

      const nameColorEl = row.querySelector('.dc-fm-nameColor');
      const msgColorEl = row.querySelector('.dc-fm-msgColor');
      const removeBtn = row.querySelector('.dc-fm-remove');

      const onChange = () => {
        updateFriend(k, { nameColor: nameColorEl.value, msgColor: msgColorEl.value });
        rerenderCommIfOpen();
      };

      nameColorEl.addEventListener('input', onChange);
      msgColorEl.addEventListener('input', onChange);

      removeBtn.addEventListener('click', () => {
        const res = removeFriend(k);
        renderFriendsManagerList(listEl);
        rerenderCommIfOpen();
        toastLocal(res.msg);
      });

      listEl.appendChild(row);
    });
  }

  function rerenderCommIfOpen() {
    const modalBody = document.getElementById(MODAL_BODY_ID);
    if (modalBody && modalVisible) renderMessage(modalBody, true);
  }

  function toastLocal(text) {
    const modalBody = document.getElementById(MODAL_BODY_ID);
    if (!modalBody) return;
    messageLog.push({ username: 'LOCAL', time: '', message: String(text || '') });
    renderMessage(modalBody, true);
  }

  function makeModalDraggable(modal, handle, onStop) {
    if (core?.ui?.makeDraggable) {
      core.ui.makeDraggable({ element: modal, handle, onStop });
      return;
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      dragging = true;
      offsetX = modal.offsetLeft - e.clientX;
      offsetY = modal.offsetTop - e.clientY;
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (typeof onStop === 'function') onStop();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      modal.style.left = e.clientX + offsetX + 'px';
      modal.style.top = e.clientY + offsetY + 'px';
    });
  }

  function makeModalResizable(modal, handle, onStop) {
    if (!handle) return;

    if (core?.ui?.makeResizable) {
      core.ui.makeResizable({ element: modal, handle, minW: 320, minH: 220, onStop });
      return;
    }

    let resizing = false;
    let startX = 0, startY = 0;
    let startW = 0, startH = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = modal.getBoundingClientRect().width;
      startH = modal.getBoundingClientRect().height;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const minW = 320;
      const minH = 220;

      const newW = Math.max(minW, startW + dx);
      const newH = Math.max(minH, startH + dy);

      modal.style.width = newW + 'px';
      modal.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      if (typeof onStop === 'function') onStop();
    });
  }

  function exportHistoryToCsv() {
    const rows = [];
    rows.push(['Username', 'Time', 'Message']);
    messageLog.forEach(msg => rows.push([msg.username ?? '', msg.time ?? '', msg.message ?? '']));

    const csvLines = rows.map(cols =>
      cols.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')
    );

    const csvContent = csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    const filename = `deepco_comm_history_${y}-${m}-${d}_${hh}${mm}${ss}.csv`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  }

  function handleLocalCommand(text) {
    const trimmed = String(text || '').trim();
    const lower = trimmed.toLowerCase();
    const modal = document.getElementById(MODAL_ID);

    switch (true) {

      case lower === '/friendsui':
        toggleFriendsManager();
        return true;

      case lower === '/friends':
        toastLocal(listFriendsText());
        return true;

      case lower.startsWith('/friend '): {
        const name = trimmed.slice('/friend '.length).trim();
        const r = addFriend(name);
        toastLocal(r.msg);
        rerenderCommIfOpen();

        const listEl = document.querySelector(`#${FM_ID} .dc-fm-list`);
        if (listEl) renderFriendsManagerList(listEl);
        return true;
      }

      case lower.startsWith('/unfriend '): {
        const name = trimmed.slice('/unfriend '.length).trim();
        const r = removeFriend(name);
        toastLocal(r.msg);
        rerenderCommIfOpen();

        const listEl = document.querySelector(`#${FM_ID} .dc-fm-list`);
        if (listEl) renderFriendsManagerList(listEl);
        return true;
      }

      case lower === '/close':
        modalVisible = false;
        if (core) setCfg(CFG_MODAL_VISIBLE, false);
        if (modal) modal.style.display = 'none';
        return true;

      case lower === '/open':
        modalVisible = true;
        if (core) setCfg(CFG_MODAL_VISIBLE, true);
        if (modal) modal.style.display = 'block';
        ensureCommModal();
        return true;

      case lower === '/toggle':
        modalVisible = !modalVisible;
        if (core) setCfg(CFG_MODAL_VISIBLE, modalVisible);
        if (modal) modal.style.display = modalVisible ? 'block' : 'none';
        if (modalVisible) ensureCommModal();
        return true;

      case lower === '/clear': {
        messageLog.length = 0;
        messageKeySet.clear();
        clearHistory();

        const modalBody = document.getElementById(MODAL_BODY_ID);
        if (modalBody) {
          const layers = ensureBodyLayers(modalBody);
          if (layers.remote) layers.remote.innerHTML = '';
          if (layers.local) layers.local.innerHTML = '';
          modalBody.scrollTop = 0;
        }
        return true;
      }

      case lower === '/help': {
        const helpText = [
          'Local commands:',
          '/help            – show this help',
          '/close           – hide Comm Terminal',
          '/open            – show Comm Terminal',
          '/toggle          – toggle Comm Terminal visibility',
          '/clear           – clear visible history in this window (and stored history)',
          '/export          – export current history to CSV (Username, Time, Message)',
          '/friend <name>   – add a friend (defaults)',
          '/unfriend <name> – remove a friend',
          '/friends         – list friends',
          '/friendsui       – toggle Friends Manager window'
        ].join('\n');

        toastLocal(helpText);
        return true;
      }

      case lower === '/export': {
        const filename = exportHistoryToCsv();
        toastLocal(`Exported ${messageLog.length} messages to CSV: ${filename}`);
        return true;
      }

      default:
        return false;
    }
  }

  function sendMessageFromModal() {
    const inputEl = document.getElementById(MODAL_INPUT_ID);
    if (!inputEl) return;

    const raw = inputEl.value;
    const text = raw.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      if (handleLocalCommand(text)) {
        inputEl.value = '';
        return;
      }

      const cmd = SLASH_COMMANDS.find(c => c.command.toLowerCase() === text.toLowerCase());
      if (cmd?.path) {
        window.location.href = cmd.path;
        inputEl.value = '';
        return;
      }
    }

    const chatRoot = getChatRoot();
    if (!chatRoot) return;

    const form =
      chatRoot.querySelector('[data-chat-target="form"]') ||
      chatRoot.querySelector('form');
    if (!form) return;

    const realInput =
      chatRoot.querySelector('[data-chat-target="input"]') ||
      form.querySelector('input[type="text"], textarea');
    if (!realInput) return;

    realInput.value = raw;
    realInput.dispatchEvent(new Event('input', { bubbles: true }));

    if (form.requestSubmit) form.requestSubmit();
    else form.submit();

    inputEl.value = '';
  }

  (function injectCss() {
    const style = document.createElement('style');
    style.textContent = `
    /* Comm modal */
    #${MODAL_ID} .dc-comm-header{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 6px;background:#15151f;border-radius:8px 8px 0 0;border-bottom:1px solid #333;user-select:none;}
    #${MODAL_ID} .dc-comm-title{font-size:12px;font-weight:700;line-height:1.1;flex:1;}
    #${MODAL_ID} .dc-comm-btn{border:1px solid #333;background:#0b0b12;color:#ddd;font-size:12px;cursor:pointer;padding:2px 6px;border-radius:8px;line-height:1;}
    #${MODAL_ID} .dc-comm-btn:hover{filter:brightness(1.1);}
    #${MODAL_ID} .dc-comm-close{border:none;background:transparent;color:#ccc;font-size:14px;cursor:pointer;padding:0 3px;line-height:1;}
    #${MODAL_ID} .dc-comm-close:hover{color:#fff;}

    #${MODAL_BODY_ID}{padding:2px 6px;height:calc(100% - 74px);overflow-y:auto;font-size:11px;background:#0a0a10;line-height:1.15;}
    #${MODAL_ID} .dc-comm-remote,#${MODAL_ID} .dc-comm-local{margin:0;padding:0;}
    #${MODAL_ID} .dc-comm-local{margin-top:4px;}

    #${MODAL_ID} .dc-comm-line{display:flex;align-items:flex-start;gap:4px;padding:1px 0;margin:0;border-bottom:1px solid rgba(255,255,255,0.03);white-space:pre-wrap;word-break:break-word;}
    #${MODAL_ID} .dc-comm-line:last-child{border-bottom:none;}
    #${MODAL_ID} .dc-comm-meta{display:flex;align-items:baseline;gap:3px;margin:0;line-height:1.1;flex-shrink:0;}
    #${MODAL_ID} .dc-comm-user{color:var(--dc-user-name-color,var(--dc-comm-user-color,#7bdcff));font-weight:600;font-size:11px;line-height:1.1;cursor:pointer;}
    #${MODAL_ID} .dc-comm-user:hover{text-decoration:underline;}
    #${MODAL_ID} .dc-comm-time{color:rgba(200,200,255,0.7);font-size:10px;line-height:1.1;}
    #${MODAL_ID} .dc-comm-sep{color:rgba(255,255,255,0.5);font-size:10px;line-height:1.1;}
    #${MODAL_ID} .dc-comm-text{color:#e4e4ff;font-size:11px;line-height:1.15;margin:0;flex:1;}

    #${MODAL_ID} .dc-comm-empty{opacity:0.6;font-style:italic;padding:2px 0;}

    #${MODAL_ID} .dc-comm-input-row{display:flex;align-items:center;gap:4px;padding:4px 6px 6px;border-top:1px solid #333;background:#14141f;border-radius:0 0 8px 8px;}
    #${MODAL_ID} .dc-comm-input{flex:1;padding:3px 5px;border-radius:5px;border:1px solid #333;background:#05050a;color:#f8f8ff;font-size:11px;line-height:1.2;}
    #${MODAL_ID} .dc-comm-input:focus{outline:none;border-color:#4b7bec;box-shadow:0 0 0 1px rgba(75,123,236,0.5);}
    #${MODAL_ID} .dc-comm-send{padding:3px 8px;font-size:11px;border-radius:999px;border:none;background:#4b7bec;color:#f8f8ff;cursor:pointer;line-height:1.2;white-space:nowrap;}
    #${MODAL_ID} .dc-comm-send:hover{filter:brightness(1.1);}

    #${MODAL_RESIZE_ID}.dc-comm-resize{position:absolute;right:4px;bottom:4px;width:12px;height:12px;cursor:nwse-resize;opacity:0.65;border-right:2px solid rgba(255,255,255,0.35);border-bottom:2px solid rgba(255,255,255,0.35);border-radius:2px;}
    #${MODAL_RESIZE_ID}.dc-comm-resize:hover{opacity:1;}

    #${MODAL_ID} .dc-comm-line.dc-comm-system .dc-comm-text{color:#ff4d4d;font-weight:700;}
    #${MODAL_ID} .dc-comm-line.dc-comm-system .dc-comm-user{color:#CC38D6;}

    /* Friends: use per-row vars if present */
    #${MODAL_ID} .dc-comm-line.dc-comm-friend .dc-comm-user{font-weight:800;}
    #${MODAL_ID} .dc-comm-line.dc-comm-friend .dc-comm-text{color:var(--dc-friend-msg, ${DEFAULT_FRIEND_MSG_COLOR}) !important;font-weight:700;}

    /* Mention highlight */
    #${MODAL_ID} .dc-comm-line.dc-comm-mention{background:rgba(255,215,0,0.12);border-left:3px solid #ffd700;padding-left:3px;margin-left:-3px;}
    #${MODAL_ID} .dc-comm-line.dc-comm-mention .dc-comm-text{font-weight:600;}

    /* Friends Manager window */
    #${FM_ID} .dc-fm-header{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#15151f;border-radius:10px 10px 0 0;border-bottom:1px solid #333;user-select:none;}
    #${FM_ID} .dc-fm-title{font-size:12px;font-weight:800;}
    #${FM_ID} .dc-fm-close{border:none;background:transparent;color:#ccc;font-size:14px;cursor:pointer;line-height:1;padding:0 4px;}
    #${FM_ID} .dc-fm-close:hover{color:#fff;}

    #${FM_ID} .dc-fm-addrow{display:flex;gap:6px;align-items:center;padding:8px;border-bottom:1px solid #222;background:#0c0c14;}
    #${FM_ID} .dc-fm-addname{flex:1;min-width:120px;padding:6px 8px;border-radius:8px;border:1px solid #333;background:#05050a;color:#f8f8ff;font-size:12px;}
    #${FM_ID} .dc-fm-colorlbl{display:flex;align-items:center;gap:6px;font-size:11px;color:#cfcfe8;white-space:nowrap;}
    #${FM_ID} input[type="color"]{width:30px;height:22px;border:none;background:transparent;padding:0;cursor:pointer;}
    #${FM_ID} .dc-fm-addbtn{padding:6px 10px;border-radius:999px;border:none;background:#4b7bec;color:#fff;cursor:pointer;font-size:12px;font-weight:700;}
    #${FM_ID} .dc-fm-addbtn:hover{filter:brightness(1.1);}

    #${FM_ID} .dc-fm-listwrap{height:calc(100% - 112px);overflow:auto;padding:8px;background:#07070d;}
    #${FM_ID} .dc-fm-empty{opacity:0.7;font-style:italic;padding:8px;}
    #${FM_ID} .dc-fm-row{display:flex;justify-content:space-between;gap:10px;padding:8px;border:1px solid rgba(255,255,255,0.06);border-radius:12px;margin-bottom:8px;background:rgba(255,255,255,0.03);}
    #${FM_ID} .dc-fm-nameText{font-size:12px;font-weight:800;}
    #${FM_ID} .dc-fm-key{font-size:10px;opacity:0.65;margin-top:2px;}
    #${FM_ID} .dc-fm-controls{display:flex;gap:8px;align-items:center;flex-shrink:0;}
    #${FM_ID} .dc-fm-remove{padding:6px 10px;border-radius:999px;border:1px solid #333;background:#120a0a;color:#ffb3b3;cursor:pointer;font-size:12px;font-weight:800;}
    #${FM_ID} .dc-fm-remove:hover{filter:brightness(1.1);}

    #${FM_ID} .dc-fm-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px;border-top:1px solid #222;background:#0c0c14;border-radius:0 0 10px 10px;}
    #${FM_ID} .dc-fm-refresh{padding:6px 10px;border-radius:999px;border:1px solid #333;background:#0b0b12;color:#ddd;cursor:pointer;font-size:12px;font-weight:700;}
    #${FM_ID} .dc-fm-refresh:hover{filter:brightness(1.1);}
    #${FM_ID} .dc-fm-hint{font-size:11px;opacity:0.7;}

    #${FM_RESIZE_ID}.dc-fm-resize{position:absolute;right:6px;bottom:6px;width:12px;height:12px;cursor:nwse-resize;opacity:0.65;border-right:2px solid rgba(255,255,255,0.35);border-bottom:2px solid rgba(255,255,255,0.35);border-radius:2px;}
    #${FM_RESIZE_ID}.dc-fm-resize:hover{opacity:1;}
    `;
    document.head.appendChild(style);
  })();

  function attachTurboHooks() {
    window.addEventListener('turbo:load', ensureCommModal);
    window.addEventListener('turbo:render', ensureCommModal);
    window.addEventListener('turbo:frame-load', ensureCommModal);
  }
  function detachTurboHooks() {
    window.removeEventListener('turbo:load', ensureCommModal);
    window.removeEventListener('turbo:render', ensureCommModal);
    window.removeEventListener('turbo:frame-load', ensureCommModal);
  }

  function destroyAll() {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById(FM_ID)?.remove();
  }

  function registerWithCore(coreObj) {
    if (core) return;
    core = coreObj;

    loadFriends();

    modalVisible = !!getCfg(CFG_MODAL_VISIBLE, true);
    friendsMgrVisible = !!getCfg(CFG_FM_VISIBLE, false);

    core.registerAddon(ADDON_ID, {
      name: 'Custom Comm Terminal',
      description: 'Comm Terminal + Friends Manager (per-friend colors).',
      defaultEnabled: true,
      ui: {
        hideDefaultEnable: false,
        controls: [
          { type: 'button', label: 'Toggle Comm Terminal', action: 'event', eventName: 'DeepCo:customCommModal:toggle' },
          { type: 'button', label: 'Friends Manager', action: 'event', eventName: 'DeepCo:customCommModal:friends' }
        ]
      },
      onConfigChange: () => {
        try {
          modalVisible = !!getCfg(CFG_MODAL_VISIBLE, true);
          friendsMgrVisible = !!getCfg(CFG_FM_VISIBLE, false);
          loadFriends();

          rerenderCommIfOpen();
          const listEl = document.querySelector(`#${FM_ID} .dc-fm-list`);
          if (listEl) renderFriendsManagerList(listEl);

          ensureCommModal();
        } catch (e) {
          log(`onConfigChange internal error: ${e?.message || e}`, 'error');
        }
      },
      enable: () => {
        addonEnabled = true;

        unsubTurbo = core?.lifecycle?.onTurbo?.(() => ensureCommModal()) || null;
        ensureCommModal();

        log('Addon enabled');
      },
      disable: () => {
        addonEnabled = false;

        try { unsubTurbo?.(); } catch (e) {} unsubTurbo = null;
        unhookChatObserver();
        destroyAll();
        restoreChatcard();

        log('Addon disabled');
      }
    });

    window.addEventListener('DeepCo:customCommModal:toggle', () => {
      if (!addonEnabled) return;
      modalVisible = !modalVisible;
      setCfg(CFG_MODAL_VISIBLE, modalVisible);
      if (!modalVisible) document.getElementById(MODAL_ID)?.style && (document.getElementById(MODAL_ID).style.display = 'none');
      else ensureCommModal();
    });

    window.addEventListener('DeepCo:customCommModal:friends', () => {
      if (!addonEnabled) return;
      toggleFriendsManager();
    });
  }

  if (window.DeepCoCore) registerWithCore(window.DeepCoCore);
  window.addEventListener('DeepCo:coreReady', (e) => registerWithCore(e.detail));
})();
