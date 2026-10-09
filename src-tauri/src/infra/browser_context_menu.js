// Runs in the initialization closure; the gesture token is never published on window.
let rightClickPrevented = false;
// Mouse gestures (Settings › Browsing): right-drag left, right or up runs back,
// forward or reload. While on, the context menu opens on release instead of press.
let gesturesEnabled = false;
let gesture = null;
let suppressMenuUntil = 0;
window.__MISTY_SET_GESTURES__ = (enabled) => { gesturesEnabled = Boolean(enabled); };

const updateRightClickState = (event) => {
  if (event.button === 2) {
    if (event.defaultPrevented) rightClickPrevented = true;
    // Move handleContextMenu to the end of the window listener queue
    // so any listeners added by page scripts run first.
    window.removeEventListener('contextmenu', handleContextMenu);
    window.addEventListener('contextmenu', handleContextMenu);
  }
};

const handleContextMenu = (event) => {
  if (!event.isTrusted) return;
  // The release that ended a gesture must not also open the menu.
  if (performance.now() < suppressMenuUntil) {
    event.preventDefault();
    return;
  }
  // If the page prevented the right-click or contextmenu event, do not show Misty's menu.
  if (event.defaultPrevented || rightClickPrevented) {
    rightClickPrevented = false;
    return;
  }
  rightClickPrevented = false;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  const editable = target.closest('input,textarea,[contenteditable="true"],[role="textbox"]');
  // Fields keep the engine's own menu so AutoFill, passwords, and spelling suggestions still work.
  if (editable) return;
  event.preventDefault();
  const sensitive = editable?.matches('input[type="password"]');
  const fieldSelection = editable && typeof editable.selectionStart === 'number'
    ? editable.value.slice(editable.selectionStart, editable.selectionEnd) : '';
  const selection = sensitive ? '' : (fieldSelection || String(window.getSelection() || '')).slice(0, 16000);
  const link = target.closest('a[href]');
  const image = target.closest('img[src]');
  const content = sensitive ? '' : selection || (target.innerText || '').slice(0, 16000);
  const safeURL = value => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : ''; } catch { return ''; } };
  const payload = {
    url: location.href.slice(0, 2048), title: document.title.slice(0, 200),
    documentRevision: `${performance.timeOrigin}:${Math.round(performance.now())}`,
    content, selection: Boolean(selection), editable: Boolean(editable),
    link: link ? safeURL(link.href) : '', image: image ? safeURL(image.currentSrc || image.src) : '',
  };
  // The page's own data may pass through its hooks; the token never does.
  const json = stringify(payload);
  if (typeof json !== 'string') return;
  const open = () => sendHostNavigation('misty-context-menu:open?token=' + encode(shortcutToken) + '&payload=' + encode(json));
  // On macOS the menu event arrives on press: wait to see whether this is a gesture.
  if (gesture) gesture.pendingMenu = open;
  else open();
};

window.addEventListener('pointerdown', updateRightClickState, true);
window.addEventListener('mousedown', updateRightClickState, true);
window.addEventListener('pointerdown', (event) => {
  if (event.button === 2 && event.defaultPrevented) rightClickPrevented = true;
}, false);
window.addEventListener('mousedown', (event) => {
  if (event.button === 2 && event.defaultPrevented) rightClickPrevented = true;
}, false);
window.addEventListener('contextmenu', handleContextMenu);

// Option-click (Alt-click) on a link opens it in Peek instead of navigating.
const peekURL = (value) => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : ''; } catch { return ''; } };
window.addEventListener('click', (event) => {
  if (!event.isTrusted || event.button !== 0 || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const link = target?.closest('a[href]');
  const url = link ? peekURL(link.href) : '';
  if (!url) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  sendHostNavigation('misty-context-menu:peek?token=' + encode(shortcutToken) + '&url=' + encode(url));
}, true);

window.addEventListener('mousedown', (event) => {
  if (gesturesEnabled && event.isTrusted && event.button === 2)
    gesture = { x: event.clientX, y: event.clientY, pendingMenu: null };
}, true);
window.addEventListener('mouseup', (event) => {
  if (!gesture || event.button !== 2) return;
  const started = gesture;
  gesture = null;
  const dx = event.clientX - started.x;
  const dy = event.clientY - started.y;
  let action = '';
  if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) / 2) action = dx < 0 ? 'back' : 'forward';
  else if (dy < -60 && Math.abs(dx) < -dy / 2) action = 'reload';
  if (action) {
    suppressMenuUntil = performance.now() + 500;
    sendHostNavigation('misty-context-menu:gesture?token=' + encode(shortcutToken) + '&action=' + action);
  } else if (started.pendingMenu) {
    started.pendingMenu();
  }
}, true);

// Protected video (DRM): when a page asks for key systems and none of them
// works within a few seconds, Misty offers to open the page in another browser.
(() => {
  const request = navigator.requestMediaKeySystemAccess?.bind(navigator);
  let reported = false;
  let succeeded = false;
  let pending = 0;
  const report = () => {
    if (reported || succeeded) return;
    reported = true;
    sendHostNavigation('misty-context-menu:compat?token=' + encode(shortcutToken) + '&kind=protected_media');
  };
  if (request) {
    navigator.requestMediaKeySystemAccess = function (keySystem, configurations) {
      return request(keySystem, configurations).then(
        (access) => { succeeded = true; return access; },
        (error) => {
          // Players try several systems; only report when none of them works.
          if (!/clearkey/i.test('' + keySystem) && !pending) pending = setTimeout(() => { pending = 0; report(); }, 3000);
          throw error;
        },
      );
    };
  }
  document.addEventListener('encrypted', () => { if (!request) report(); }, true);
})();
