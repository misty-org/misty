// Runs in the initialization closure; the gesture token is never published on window.
let rightClickPrevented = false;
// Mouse gestures (Settings › Advanced): right-drag left, right or up runs back,
// forward or reload. While on, the context menu opens on release instead of press.
// A two-finger trackpad swipe past the page's edge goes back or forward whatever the
// setting; both show the same arrow (below).
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

// The arrow that shows where a gesture leads: a black circle sliding in from the edge
// (top for reload) that turns white once letting go would navigate. It lives in a closed
// shadow root so the page's styles cannot reach it.
const gestureArrow = (() => {
  let host = null;
  let circle = null;
  let hideTimer = 0;
  const arrow = '<path d="M5 12h14M13 6l6 6-6 6"/>';
  const reload = '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>';
  const build = () => {
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>.c{position:fixed;width:56px;height:56px;box-sizing:border-box;border-radius:50%;'
      + 'background:#000;border:1px solid rgba(255,255,255,.35);color:#fff;display:grid;place-items:center;'
      + 'opacity:0;transition:opacity .12s,background-color .12s,color .12s,border-color .12s;}'
      + '.c.ready{background:#fff;color:#000;border-color:#fff}'
      + 'svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}</style>'
      + '<div class="c"><svg viewBox="0 0 24 24"></svg></div>';
    circle = root.querySelector('.c');
  };
  return {
    // progress runs from 0 (just started) to 1 (letting go navigates).
    show(action, progress) {
      if (!host) build();
      clearTimeout(hideTimer);
      if (!host.isConnected) (document.body || document.documentElement).append(host);
      const p = Math.max(0, Math.min(1, progress));
      const inset = Math.round(-56 + 40 * p) + 'px';
      const svg = circle.firstElementChild;
      const icon = action === 'reload' ? reload : arrow;
      if (svg.innerHTML !== icon) svg.innerHTML = icon;
      svg.style.transform = action === 'back' ? 'rotate(180deg)' : '';
      const style = circle.style;
      style.top = style.left = style.right = style.marginTop = style.marginLeft = '';
      if (action === 'reload') {
        style.top = inset;
        style.left = '50%';
        style.marginLeft = '-28px';
      } else {
        style.top = '50%';
        style.marginTop = '-28px';
        style[action === 'back' ? 'left' : 'right'] = inset;
      }
      style.opacity = String(Math.min(1, p * 2));
      circle.classList.toggle('ready', p >= 1);
    },
    hide() {
      if (!circle) return;
      circle.style.opacity = '0';
      circle.classList.remove('ready');
      hideTimer = setTimeout(() => host.remove(), 150);
    },
  };
})();

const sendGesture = (action, source) =>
  sendHostNavigation('misty-context-menu:gesture?token=' + encode(shortcutToken) + '&action=' + action + '&source=' + source);

// Right-drag past 60px; a slant up to half the distance still counts.
const dragAction = (dx, dy, distance) => {
  if (Math.abs(dx) > distance && Math.abs(dy) < Math.abs(dx) / 2) return dx < 0 ? 'back' : 'forward';
  if (dy < -distance && Math.abs(dx) < -dy / 2) return 'reload';
  return '';
};
window.addEventListener('mousedown', (event) => {
  if (gesturesEnabled && event.isTrusted && event.button === 2)
    gesture = { x: event.clientX, y: event.clientY, pendingMenu: null };
}, true);
window.addEventListener('mousemove', (event) => {
  if (!gesture || !(event.buttons & 2)) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const action = dragAction(dx, dy, 12);
  if (action) gestureArrow.show(action, (action === 'reload' ? -dy : Math.abs(dx)) / 60);
  else gestureArrow.hide();
}, true);
window.addEventListener('mouseup', (event) => {
  if (!gesture || event.button !== 2) return;
  const started = gesture;
  gesture = null;
  gestureArrow.hide();
  const action = dragAction(event.clientX - started.x, event.clientY - started.y, 60);
  if (action) {
    suppressMenuUntil = performance.now() + 500;
    sendGesture(action, 'drag');
  } else if (started.pendingMenu) {
    started.pendingMenu();
  }
}, true);

// Two-finger swipe: horizontal scrolling that nothing on the page can take moves the
// arrow in from that edge; letting go past the threshold goes back (swipe right) or
// forward (swipe left). Listened for after the page's own handlers, so a page that
// handles sideways wheel itself (maps, carousels) keeps it. A scroll that reached the
// edge must pause before the next one navigates, as in other Mac browsers.
const swipeThreshold = 150;
let swipe = null;
let swipeLockedUntil = 0;
let edgeHoldUntil = 0;
const scrollsSideways = (target, dx) => {
  const room = (el) => (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  for (let el = target instanceof Element ? target : target?.parentElement; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX) && room(el))
      return true;
  }
  const page = document.scrollingElement || document.documentElement;
  return room(page);
};
const endSwipe = () => {
  const ended = swipe;
  swipe = null;
  gestureArrow.hide();
  if (ended && ended.distance >= swipeThreshold) {
    swipeLockedUntil = performance.now() + 600;
    sendGesture(ended.action, 'swipe');
  }
};
window.addEventListener('wheel', (event) => {
  if (!event.isTrusted || event.ctrlKey || event.defaultPrevented) return;
  const now = performance.now();
  if (now < swipeLockedUntil) return;
  const dx = event.deltaMode === 0 ? event.deltaX : event.deltaX * 16;
  const sideways = Math.abs(dx) > Math.abs(event.deltaY);
  if (!swipe) {
    if (!sideways) return;
    if (scrollsSideways(event.target, dx)) {
      edgeHoldUntil = now + 250;
      return;
    }
    if (now < edgeHoldUntil) {
      edgeHoldUntil = now + 250;
      return;
    }
    swipe = { action: dx < 0 ? 'back' : 'forward', distance: 0, timer: 0 };
  } else if (!sideways && Math.abs(event.deltaY) > 2 * Math.abs(dx)) {
    clearTimeout(swipe.timer);
    swipe = null;
    gestureArrow.hide();
    return;
  }
  swipe.distance += swipe.action === 'back' ? -dx : dx;
  if (swipe.distance <= 0) {
    clearTimeout(swipe.timer);
    swipe = null;
    gestureArrow.hide();
    return;
  }
  gestureArrow.show(swipe.action, swipe.distance / swipeThreshold);
  clearTimeout(swipe.timer);
  swipe.timer = setTimeout(endSwipe, 140);
}, { passive: true });

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
