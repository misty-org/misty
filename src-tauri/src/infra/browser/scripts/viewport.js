(() => {
  const shortcutToken = __MISTY_SHORTCUT_TOKEN_PLACEHOLDER__;
  // Page scripts share this JavaScript world and run after this one. They can
  // replace globals, prototype methods (postMessage, URLSearchParams) and
  // Object.prototype.toJSON, so nothing that carries the token may reach them.
  // Capture what the messages need now and build them by concatenation.
  const encode = encodeURIComponent;
  const stringify = JSON.stringify;
  // Kiri's host channel: the engine's native message handler, bound here.
  const bindChannel = __KIRI_HOST_SENDER_PLACEHOLDER__;
  let postToHost = bindChannel();
  const sendToHost = (message) => {
    // The handler is normally installed before the first document starts.
    postToHost = postToHost || bindChannel();
    if (!postToHost) return false;
    postToHost(message);
    return true;
  };
  const finite = (value) => (typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity ? value : 0);
  // Host navigations are posted through the captured channel: a page can
  // observe its own navigations, but not a bound native function call.
  const sendHostNavigation = (url) => {
    sendToHost('{"navigate":"' + url + '"}');
  };
  const sendFocus = () => {
    sendToHost(shortcutToken);
  };
  __MISTY_CONTEXT_MENU_PLACEHOLDER__
  __MISTY_BACKGROUND_PLACEHOLDER__
  let pointerTrackingEnabled = __MISTY_POINTER_TRACKING_PLACEHOLDER__;

  // External pages own their layout and scrolling behavior. Page zoom is
  // handled by the native WebView; never emulate it with DOM observers,
  // overflow overrides, or scroll-position corrections here.

  let pendingEvent = null;
  let frame = 0;
  let lastPointerReport = 0;

  // Pointer coordinates are needed only while the explicitly summoned Misty
  // companion is present. Keeping this off otherwise avoids forcing every
  // page selection drag through DOM mutation, navigation, and native IPC.
  window.__MISTY_SET_POINTER_TRACKING__ = (enabled) => {
    pointerTrackingEnabled = Boolean(enabled);
    if (!pointerTrackingEnabled) {
      pendingEvent = null;
      lastPointerReport = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  // Only bindings supplied by Misty's trusted shell are intercepted. Page
  // typing and ordinary browser shortcuts remain owned by the page.
  const initialBindings = __MISTY_INITIAL_SHORTCUTS_PLACEHOLDER__;
  window.__MISTY_APP_SHORTCUTS__ = window.__MISTY_APP_SHORTCUTS__ || new Map(
    (Array.isArray(initialBindings) ? initialBindings : []).map((binding) => [
      binding.shortcut,
      Boolean(binding.allowInEditable),
    ])
  );
  window.__MISTY_SET_SHORTCUTS__ = (bindings) => {
    window.__MISTY_APP_SHORTCUTS__ = new Map((Array.isArray(bindings) ? bindings : [])
      .map((binding) => [binding.shortcut, Boolean(binding.allowInEditable)]));
  };
  const shortcutKey = (event) => {
    let key = event.code;
    if (/^Key[A-Z]$/i.test(key)) key = key.slice(3).toUpperCase();
    else if (/^Digit[0-9]$/.test(key)) key = key.slice(5);
    else key = ({
      Backquote: 'Grave', Backslash: 'Backslash', BracketLeft: 'LeftBracket',
      BracketRight: 'RightBracket', Comma: 'Comma', Period: 'Period',
      Equal: 'Plus', Minus: 'Minus', NumpadAdd: 'Plus', NumpadSubtract: 'Minus',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown', PageUp: 'PageUp', PageDown: 'PageDown',
      Escape: 'Escape', Esc: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace'
    })[key] || (event.key?.length === 1 ? event.key.toUpperCase() : event.key);
    // `+` already implies Shift on the main keyboard. Match the renderer's
    // canonical form (Cmd+Plus rather than Cmd+Shift+Plus).
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt',
      event.shiftKey && key !== 'Plus' && 'Shift',
      event.metaKey && 'Cmd', key].filter(Boolean).join('+');
  };
  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    const shortcut = shortcutKey(event);
    const editable = Boolean(event.target?.closest?.(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]'
    ));
    const allowInEditable = window.__MISTY_APP_SHORTCUTS__.get(shortcut);
    if (allowInEditable === undefined || (editable && !allowInEditable)) return;
    const flag = (value) => (value === true ? 'true' : 'false');
    const params = 'key=' + encode(event.key) + '&code=' + encode(event.code) +
      '&alt=' + flag(event.altKey) + '&ctrl=' + flag(event.ctrlKey) + '&meta=' + flag(event.metaKey) +
      '&shift=' + flag(event.shiftKey) + '&repeat=' + flag(event.repeat) +
      '&token=' + encode(shortcutToken) + '&editable=' + flag(editable);
    sendHostNavigation('misty-shortcut:event?' + params);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // A native child WebView sits outside the renderer's DOM event tree. Send
  // one trusted focus signal on pointer-down so the owning split becomes the
  // active workspace pane before shell shortcuts are evaluated.
  document.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted) return;
    sendFocus();
  }, true);

__MISTY_MEDIA_PLACEHOLDER__

__MISTY_WINDOW_DRAG_PLACEHOLDER__

  const sendPointer = (pointer) => {
    sendToHost('{"token":"' + shortcutToken + '","pointer":{"x":' + finite(pointer.x) + ',"y":' + finite(pointer.y) +
      ',"inside":' + (pointer.inside === true ? 'true' : 'false') + '}}');
  };
  const reportPointer = (event) => {
    if (!pointerTrackingEnabled || !event?.isTrusted) return;
    const now = performance.now();
    if (now - lastPointerReport < 33) return;
    lastPointerReport = now;
    const x = Math.max(0, Math.min(window.innerWidth, Number(event.clientX) || 0));
    const y = Math.max(0, Math.min(window.innerHeight, Number(event.clientY) || 0));
    sendPointer({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, inside: true });
  };

  const reportPointerLeave = () => {
    if (!pointerTrackingEnabled) return;
    sendPointer({ x: 0, y: 0, inside: false });
  };

  const flush = () => {
    frame = 0;
    if (pendingEvent) {
      reportPointer(pendingEvent);
    }
    pendingEvent = null;
  };
  const track = (event) => {
    if (!pointerTrackingEnabled) return;
    pendingEvent = event;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const handleLinkClick = (event) => {
    if (!event.isTrusted || event.defaultPrevented) return;
    const isMiddleClick = event.type === 'auxclick' && event.button === 1;
    const isLeftClick = event.type === 'click' && event.button === 0;
    const isModifierClick =
      isLeftClick && (event.metaKey || event.ctrlKey);
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    // Let the site's router and WebKit handle ordinary links and named targets.
    // Only explicit new-tab gestures need host assistance.
    if (!isMiddleClick && !isModifierClick) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      const resolved = new URL(href, window.location.href).href;
      if (/^https?:\/\//i.test(resolved)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.open(resolved, '_blank');
      }
    } catch (_) {}
  };
  document.addEventListener('click', handleLinkClick);
  document.addEventListener('auxclick', handleLinkClick);
  document.addEventListener('pointerover', track, true);
  document.addEventListener('pointermove', track, true);
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) {
      reportPointerLeave();
    }
  }, true);
  window.addEventListener('blur', () => {
    reportPointerLeave();
  });
})();
