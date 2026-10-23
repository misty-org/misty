use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

pub(super) const BROWSER_VIEWPORT_SCRIPT: &str = r#"
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

  // What the page is playing, in one place: the snapshot the media card reads on request, and the
  // one pushed to the host the moment anything about it changes (play, pause, seek, a new track,
  // picture in picture), so the card never waits on a timer.
  const mediaSnapshot = () => {
    const nav = window.navigator;
    const media = Array.from(document.querySelectorAll('video, audio'));
    const element =
      media.find((m) => !m.paused && !m.ended) ||
      media.find((m) => m.dataset && m.dataset.mistyPaused === '1') ||
      media.filter((m) => m.currentTime > 0).sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
    const meta = nav && nav.mediaSession && nav.mediaSession.metadata;
    const size = (art) => Math.max(...String(art.sizes || '0x0').split(/\s+/).map((v) => parseInt(v, 10) || 0));
    const art = Array.from((meta && meta.artwork) || [])
      .filter((a) => /^https:/.test(a.src || ''))
      .sort((a, b) => size(b) - size(a));
    const pick = art.find((a) => size(a) <= 512) || art[art.length - 1];
    const og = document.querySelector('meta[property="og:image"]');
    const ogImage = og && /^https:/.test(og.content || '') ? og.content : '';
    const actions = window.__mistyMediaActions;
    const finite = (n) => (Number.isFinite(n) ? n : null);
    const text = (v, max) => String(v || '').slice(0, max);
    const artwork = text((pick && pick.src) || ogImage, 600);
    return {
      title: text(meta && meta.title, 200),
      artist: text(meta && meta.artist, 200),
      artwork: artwork.length >= 600 ? '' : artwork,
      duration: element ? finite(element.duration) : null,
      position: element ? finite(element.currentTime) : null,
      paused: element ? element.paused : Boolean(nav && nav.mediaSession && nav.mediaSession.playbackState === 'paused'),
      // A media session is alive: something has played and has not ended, even if it is paused now.
      hasMedia: Boolean(element && !element.ended && (element.currentTime > 0 || !element.paused)),
      canPrevious: Boolean(actions && actions.has('previoustrack')),
      canNext: Boolean(actions && actions.has('nexttrack')),
      pictureInPicture: Boolean(
        document.pictureInPictureElement ||
        media.some((m) => m.webkitPresentationMode === 'picture-in-picture')
      ),
    };
  };
  window.__mistyMediaSnapshot = mediaSnapshot;

  // What a video has said, for questions at the cursor (browser/page_tools/media_tools/session.rs). Captions are
  // read in every frame by captions.js before a question, so this never waits: the top
  // document's own video first, else the video playing in a frame below it (a course video in
  // Canvas plays in a frame from Canvas Studio, Kaltura, Panopto or YouTube).
  window.__mistyMediaContext = () => {
    const now = mediaSnapshot();
    const own = window.__mistyFrameMedia ? window.__mistyFrameMedia() : null;
    const local = {
      title: String(now.title || document.title || '').slice(0, 200),
      url: String(location.href).slice(0, 2048),
      time: now.position,
      duration: now.duration,
      paused: now.paused,
      hasMedia: now.hasMedia,
      captions: (own && own.captions) || null,
    };
    if (local.hasMedia && !local.paused) return local;
    const framed = window.__mistyFramedMedia ? window.__mistyFramedMedia() : null;
    if (!framed || !framed.hasMedia || (local.hasMedia && framed.paused)) return local;
    // The page around the frame names the video better than the player does.
    return {
      title: String(now.title || document.title || framed.title || '').slice(0, 200),
      url: local.url,
      time: framed.time,
      duration: framed.duration,
      paused: framed.paused,
      hasMedia: true,
      captions: framed.captions,
    };
  };
  let mediaTimer = 0;
  const reportMedia = () => {
    mediaTimer = 0;
    sendToHost('{"token":"' + shortcutToken + '","media":' + JSON.stringify(mediaSnapshot()) + '}');
  };
  const scheduleMediaReport = () => {
    if (window !== window.top || mediaTimer) return;
    // Events arrive in bursts (a seek is pause, seeked and play together); one report follows.
    mediaTimer = setTimeout(reportMedia, 80);
  };
  ['play', 'pause', 'ended', 'seeked', 'durationchange', 'loadedmetadata', 'emptied', 'ratechange',
   'enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'].forEach((name) => {
    // Media events do not bubble, so they are caught on the way down.
    document.addEventListener(name, (event) => {
      const target = event.target;
      if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
        scheduleMediaReport();
      }
    }, true);
  });
  try {
    // A page announces a new track by setting its media session's metadata.
    const session = window.navigator && window.navigator.mediaSession;
    const prototype = session && Object.getPrototypeOf(session);
    const original = prototype && Object.getOwnPropertyDescriptor(prototype, 'metadata');
    if (session && original && original.get && original.set) {
      Object.defineProperty(session, 'metadata', {
        configurable: true,
        get() { return original.get.call(this); },
        set(value) { original.set.call(this, value); scheduleMediaReport(); },
      });
    }
  } catch (_) {}

  // A video that comes back from picture in picture still playing, as when its window's "back to
  // tab" is chosen, brings its tab with it. The page may have been hidden behind another tab by
  // then, and the system would return the video to a page it cannot find; the same trusted
  // focus signal as a click shows the tab first. Closing the floating window pauses the video, so
  // that does not pull the person back.
  const returnFromPictureInPicture = (event) => {
    const video = event.target;
    if (!event.isTrusted || !video || video.paused) return;
    // Brings Misty's window forward too, which the system does not do for a page it hosts.
    sendToHost('{"token":"' + shortcutToken + '","pipReturn":true}');
  };
  document.addEventListener('leavepictureinpicture', returnFromPictureInPicture, true);
  document.addEventListener('webkitpresentationmodechanged', (event) => {
    const video = event.target;
    if (video && video.webkitPresentationMode === 'inline') returnFromPictureInPicture(event);
  }, true);

  // The top edge of a page moves the window, as a titlebar would: press on empty space there
  // and drag. Links, controls, text and anything the page gives a special cursor keep their
  // clicks. The drag starts only once the pointer has moved, so a plain click is the page's.
  const dragZone = () => Math.min(72, window.innerHeight * 0.05);
  // A wrapper that spans the page (an app shell with a tabindex, or a pointer cursor set on a
  // whole layout) must not turn the whole top edge into content.
  const spansPage = (element) => {
    const box = element.getBoundingClientRect();
    return box.width >= window.innerWidth * 0.8 && box.height >= window.innerHeight * 0.5;
  };
  const interactiveTarget = (target) => {
    const element = target instanceof Element ? target : target && target.parentElement;
    if (!element) return true;
    if (element.closest(
      'a[href], button, input, textarea, select, summary, label, video, audio, canvas, iframe, ' +
      '[role="button"], [role="link"], [role="textbox"], [role="menuitem"], [role="tab"], ' +
      '[contenteditable]:not([contenteditable="false"]), [draggable="true"]'
    )) return true;
    for (let node = element; node; node = node.parentElement) {
      if (node.matches('[tabindex]:not([tabindex="-1"])') && !spansPage(node)) return true;
    }
    const cursor = getComputedStyle(element).cursor;
    if (cursor === 'auto' || cursor === 'default') return false;
    // The cursor is inherited: find where it starts, and ignore it when that is a page-wide wrapper.
    let origin = element;
    while (origin.parentElement && getComputedStyle(origin.parentElement).cursor === cursor)
      origin = origin.parentElement;
    return !spansPage(origin);
  };
  let dragStart = null;
  let lastTopPress = null;
  document.addEventListener('pointerdown', (event) => {
    dragStart = null;
    if (!event.isTrusted || event.button !== 0 || window !== window.top) return;
    if (event.clientY > dragZone() || interactiveTarget(event.target)) {
      lastTopPress = null;
      return;
    }
    // A second press in the same spot is the titlebar's double-click: zoom or restore.
    const now = performance.now();
    if (lastTopPress && now - lastTopPress.time <= 500 &&
        Math.abs(event.clientX - lastTopPress.x) + Math.abs(event.clientY - lastTopPress.y) <= 8) {
      lastTopPress = null;
      sendToHost('{"token":"' + shortcutToken + '","zoom":true}');
      return;
    }
    lastTopPress = { time: now, x: event.clientX, y: event.clientY };
    dragStart = { x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    if (!event.isTrusted || (event.buttons & 1) === 0) {
      dragStart = null;
      return;
    }
    if (Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y) < 4) return;
    dragStart = null;
    sendToHost('{"token":"' + shortcutToken + '","drag":true}');
  }, true);
  document.addEventListener('pointerup', () => { dragStart = null; }, true);

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
"#;

pub(super) fn browser_viewport_script(
    shortcut_token: &str,
    pointer_tracking: bool,
    bindings: &[super::super::browser_shortcuts::BrowserShortcutBinding],
) -> String {
    let bindings_json = serde_json::to_string(bindings).unwrap_or_else(|_| "[]".to_owned());
    BROWSER_VIEWPORT_SCRIPT
        .replace(
            "__KIRI_HOST_SENDER_PLACEHOLDER__",
            kiri::channel::sender_script(),
        )
        .replace(
            "__MISTY_BACKGROUND_PLACEHOLDER__",
            if cfg!(target_os = "macos") {
                include_str!("background.js")
            } else {
                ""
            },
        )
        .replace(
            "__MISTY_CONTEXT_MENU_PLACEHOLDER__",
            concat!(
                include_str!("context_menu.js"),
                "\n",
                include_str!("passwords.js"),
                "\n",
                include_str!("extension_store.js")
            ),
        )
        .replace(
            "__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__",
            &serde_json::to_string(shortcut_token).unwrap_or_else(|_| "\"\"".to_owned()),
        )
        .replace(
            "__MISTY_POINTER_TRACKING_PLACEHOLDER__",
            if pointer_tracking { "true" } else { "false" },
        )
        .replace("__MISTY_INITIAL_SHORTCUTS_PLACEHOLDER__", &bindings_json)
}

static STATUS_BUBBLE_ENABLED: AtomicBool = AtomicBool::new(true);

/// Whether pages show the hovered-link and loading bubble. Misty's settings
/// push the user's preference; pages created afterwards start with it.
pub(super) fn set_status_bubble_enabled(enabled: bool) {
    STATUS_BUBBLE_ENABLED.store(enabled, Ordering::Relaxed);
}

/// The tab's token authenticates the Escape-to-stop report on Kiri's host channel.
pub(super) fn browser_status_script(shortcut_token: &str) -> String {
    include_str!("status.js")
        .replace(
            "__MISTY_STATUS_ENABLED_PLACEHOLDER__",
            if STATUS_BUBBLE_ENABLED.load(Ordering::Relaxed) {
                "true"
            } else {
                "false"
            },
        )
        .replace(
            "__KIRI_HOST_SENDER_PLACEHOLDER__",
            kiri::channel::sender_script(),
        )
        .replace(
            "__MISTY_STATUS_TOKEN_PLACEHOLDER__",
            &serde_json::to_string(shortcut_token).unwrap_or_else(|_| "\"\"".to_owned()),
        )
}

/// Reads what videos say in every frame and gathers it in the top document
/// (captions.js). It carries no token: frames talk to the top over postMessage.
pub(super) fn browser_captions_script() -> String {
    concat!(
        "(() => {
",
        include_str!("caption_parsers.js"),
        "
",
        include_str!("captions.js"),
        "
})();
"
    )
    .to_owned()
}

pub(super) fn browser_status_update_script(state: &serde_json::Value) -> String {
    format!("window.__MISTY_SET_STATUS__?.({state});")
}

pub(super) const BROWSER_FAVICON_SCRIPT: &str = r#"
(() => {
  const candidates = Array.from(document.querySelectorAll('link[rel][href]'))
    .map((link) => {
      const rel = String(link.rel || '').toLowerCase().split(/\s+/);
      const isIcon = rel.includes('icon') || rel.some((token) => token.includes('apple-touch-icon'));
      if (!isIcon || !/^https?:$/i.test(link.href ? new URL(link.href).protocol : '')) return null;
      const sizes = String(link.sizes?.value || link.getAttribute('sizes') || '').toLowerCase();
      const dimensions = Array.from(sizes.matchAll(/(\d+)x(\d+)/g));
      const largest = dimensions.reduce((value, match) => {
        return Math.max(value, Number(match[1]) || 0, Number(match[2]) || 0);
      }, 0);
      const vector = String(link.type || '').toLowerCase() === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(link.href);
      const scalable = sizes.includes('any');
      const standardIcon = rel.includes('icon') ? 100 : 0;
      return {
        href: link.href,
        score: vector ? 1_000_000 : scalable ? 900_000 : standardIcon + largest,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.href || null;
})()
"#;

pub(super) const BROWSER_COMPATIBILITY_SCRIPT: &str = r#"
(() => {
  const running = document.querySelector('#challenge-running');
  const interstitial = Boolean(window._cf_chl_opt || running);
  const challengePage = String(document.title || '').trim().toLowerCase() === 'just a moment...';
  if (!interstitial || (!running && !challengePage)) return null;
  return {
    kind: 'cloudflare_challenge',
    url: location.href,
  };
})()
"#;

#[derive(Debug, PartialEq)]
pub(super) struct BrowserPointerNavigation {
    pub x: f64,
    pub y: f64,
    pub inside: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserPointerEvent {
    id: String,
    x: f64,
    y: f64,
    inside: bool,
}

pub(super) fn emit_browser_pointer(app: &AppHandle, id: &str, pointer: BrowserPointerNavigation) {
    let _ = app.emit_to(
        crate::infra::browser::browser_owner_label(app, id),
        "misty://browser-pointer",
        BrowserPointerEvent {
            id: id.to_owned(),
            x: pointer.x,
            y: pointer.y,
            inside: pointer.inside,
        },
    );
}

#[cfg(test)]
mod tests;
