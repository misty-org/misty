// Runs in the initialization closure; the shortcut token is never published on window.
let rightClickPrevented = false;
// A two-finger trackpad swipe past the page's edge goes back or forward, with an arrow (below).

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
  const selection = sensitive ? '' : fieldSelection || String(window.getSelection() || '');
  const link = target.closest('a[href]');
  const image = target.closest('img[src]');
  const safeURL = value => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : ''; } catch { return ''; } };
  const payload = {
    url: location.href.slice(0, 2048), selection: Boolean(selection), editable: Boolean(editable),
    link: link ? safeURL(link.href) : '', image: image ? safeURL(image.currentSrc || image.src) : '',
  };
  // The page's own data may pass through its hooks; the token never does.
  const json = stringify(payload);
  if (typeof json !== 'string') return;
  sendHostNavigation('misty-context-menu:open?token=' + encode(shortcutToken) + '&payload=' + encode(json));
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

// The arrow that shows where a swipe leads: a black circle sliding in from the edge
// that turns white once letting go would navigate. It lives in a closed
// shadow root so the page's styles cannot reach it.
const gestureArrow = (() => {
  let host = null;
  let circle = null;
  let hideTimer = 0;
  const arrow = '<path d="M5 12h14M13 6l6 6-6 6"/>';
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
      if (svg.innerHTML !== arrow) svg.innerHTML = arrow;
      svg.style.transform = action === 'back' ? 'rotate(180deg)' : '';
      const style = circle.style;
      style.top = style.left = style.right = style.marginTop = style.marginLeft = '';
      style.top = '50%';
      style.marginTop = '-28px';
      style[action === 'back' ? 'left' : 'right'] = inset;
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

const sendGesture = (action) =>
  sendHostNavigation('misty-context-menu:gesture?token=' + encode(shortcutToken) + '&action=' + action);

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
    sendGesture(ended.action);
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
