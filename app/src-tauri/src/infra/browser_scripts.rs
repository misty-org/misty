use serde::Serialize;
use tauri::{AppHandle, Emitter};
use url::Url;

pub(super) const BROWSER_VIEWPORT_SCRIPT: &str = r#"
(() => {
  const shortcutToken = __MISTY_SHORTCUT_TOKEN_PLACEHOLDER__;
  let pointerTrackingEnabled = __MISTY_POINTER_TRACKING_PLACEHOLDER__;
  const install = () => {
    if (document.getElementById('misty-browser-viewport-style')) return;
    const style = document.createElement('style');
    style.id = 'misty-browser-viewport-style';
    style.textContent = 'html, body { overscroll-behavior: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };

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
  window.__MISTY_APP_SHORTCUTS__ = window.__MISTY_APP_SHORTCUTS__ || new Map();
  window.__MISTY_SET_SHORTCUTS__ = (bindings) => {
    window.__MISTY_APP_SHORTCUTS__ = new Map((Array.isArray(bindings) ? bindings : [])
      .map((binding) => [binding.shortcut, Boolean(binding.allowInEditable)]));
  };
  const shortcutKey = (event) => {
    let key = event.code;
    if (/^Key[A-Z]$/.test(key)) key = key.slice(3);
    else if (/^Digit[0-9]$/.test(key)) key = key.slice(5);
    else key = ({
      Backquote: 'Grave', Backslash: 'Backslash', BracketLeft: 'LeftBracket',
      BracketRight: 'RightBracket', Comma: 'Comma', Period: 'Period',
      Equal: 'Plus', Minus: 'Minus', NumpadAdd: 'Plus', NumpadSubtract: 'Minus',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown', PageUp: 'PageUp', PageDown: 'PageDown'
    })[key] || event.key;
    // `+` already implies Shift on the main keyboard. Match the renderer's
    // canonical form (Cmd+Plus rather than Cmd+Shift+Plus).
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt',
      event.shiftKey && key !== 'Plus' && 'Shift',
      event.metaKey && 'Cmd', key].filter(Boolean).join('+');
  };
  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    const shortcut = shortcutKey(event);
    const editable = Boolean(event.target?.closest?.(
      'input, textarea, select, [contenteditable="true"], [role="textbox"]'
    ));
    const allowInEditable = window.__MISTY_APP_SHORTCUTS__.get(shortcut);
    if (allowInEditable === undefined || (editable && !allowInEditable)) return;
    const params = new URLSearchParams({
      key: event.key, code: event.code, alt: String(event.altKey),
      ctrl: String(event.ctrlKey), meta: String(event.metaKey), shift: String(event.shiftKey),
      repeat: String(event.repeat), token: shortcutToken, editable: String(editable)
    });
    window.location.href = `misty-shortcut:event?${params}`;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // A native child WebView sits outside the renderer's DOM event tree. Send
  // one trusted focus signal on pointer-down so the owning split becomes the
  // active workspace pane before shell shortcuts are evaluated.
  document.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted) return;
    const params = new URLSearchParams({ token: shortcutToken });
    window.location.href = `misty-focus:event?${params}`;
  }, true);

  const reportPointer = (event) => {
    if (!pointerTrackingEnabled || !event?.isTrusted) return;
    const now = performance.now();
    if (now - lastPointerReport < 33) return;
    lastPointerReport = now;
    const x = Math.max(0, Math.min(window.innerWidth, Number(event.clientX) || 0));
    const y = Math.max(0, Math.min(window.innerHeight, Number(event.clientY) || 0));
    window.location.href = `misty-pointer:move?x=${Math.round(x * 10) / 10}&y=${Math.round(y * 10) / 10}`;
  };

  const reportPointerLeave = () => {
    if (!pointerTrackingEnabled) return;
    window.location.href = 'misty-pointer:leave';
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

  install();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  const handleLinkClick = (event) => {
    if (!event.isTrusted) return;
    const isMiddleClick = event.type === 'auxclick' && event.button === 1;
    const isLeftClick = event.type === 'click' && event.button === 0;
    const isModifierClick =
      isLeftClick && (event.metaKey || event.ctrlKey);
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    const target = (anchor.getAttribute('target') || '').trim().toLowerCase();
    const isNewWindowTarget =
      isLeftClick &&
      (target === '_blank' ||
        target === '_new' ||
        (target && target !== '_self' && target !== '_top' && target !== '_parent'));

    if (!isMiddleClick && !isModifierClick && !isNewWindowTarget) return;

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
  document.addEventListener('click', handleLinkClick, true);
  document.addEventListener('auxclick', handleLinkClick, true);
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

pub(super) const BROWSER_COMPANION_SCRIPT: &str = r#"
(() => {
  window.__MISTY_SET_COMPANION__ = () => {};
})();
"#;

pub(super) fn browser_viewport_script(shortcut_token: &str, pointer_tracking: bool) -> String {
    BROWSER_VIEWPORT_SCRIPT
        .replace(
            "__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__",
            &serde_json::to_string(shortcut_token).unwrap_or_else(|_| "\"\"".to_owned()),
        )
        .replace(
            "__MISTY_POINTER_TRACKING_PLACEHOLDER__",
            if pointer_tracking { "true" } else { "false" },
        )
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
        "main",
        "misty://browser-pointer",
        BrowserPointerEvent {
            id: id.to_owned(),
            x: pointer.x,
            y: pointer.y,
            inside: pointer.inside,
        },
    );
}

pub(super) fn browser_pointer_navigation(url: &Url) -> Option<BrowserPointerNavigation> {
    if url.scheme() != "misty-pointer" {
        return None;
    }
    if url.path().trim_start_matches('/') == "leave" {
        return Some(BrowserPointerNavigation {
            x: 0.0,
            y: 0.0,
            inside: false,
        });
    }
    if url.path().trim_start_matches('/') != "move" {
        return None;
    }
    let mut x = None;
    let mut y = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "x" => x = value.parse::<f64>().ok(),
            "y" => y = value.parse::<f64>().ok(),
            _ => {}
        }
    }
    let (x, y) = (x?, y?);
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 || x > 100_000.0 || y > 100_000.0 {
        return None;
    }
    Some(BrowserPointerNavigation { x, y, inside: true })
}

#[cfg(test)]
mod tests {
    use super::{
        browser_pointer_navigation, browser_viewport_script, BROWSER_COMPANION_SCRIPT,
        BROWSER_VIEWPORT_SCRIPT,
    };
    use url::Url;

    #[test]
    fn pointer_reporting_uses_no_page_dom_mutation_or_remote_desktop_ipc() {
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("misty-cursor:"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("document.createElement('a')"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("__TAURI_INTERNALS__"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("misty-pointer:move"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("misty-focus:event"));
    }

    #[test]
    fn pointer_navigation_accepts_only_bounded_coordinates() {
        let pointer =
            browser_pointer_navigation(&Url::parse("misty-pointer:move?x=12.5&y=44").unwrap())
                .unwrap();
        assert_eq!(pointer.x, 12.5);
        assert_eq!(pointer.y, 44.0);
        assert!(pointer.inside);
        assert!(
            browser_pointer_navigation(&Url::parse("misty-pointer:move?x=-1&y=4").unwrap())
                .is_none()
        );
        assert!(
            !browser_pointer_navigation(&Url::parse("misty-pointer:leave").unwrap())
                .unwrap()
                .inside
        );
    }

    #[test]
    fn shortcut_token_is_embedded_as_json_without_becoming_a_window_global() {
        let script = browser_viewport_script("secret-token", false);
        assert!(script.contains("const shortcutToken = \"secret-token\""));
        assert!(script.contains("let pointerTrackingEnabled = false"));
        assert!(script.contains("if (!pointerTrackingEnabled || !event?.isTrusted) return"));
        assert!(script.contains("if (!event.isTrusted) return"));
        assert!(!script.contains("__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__"));
        assert!(!script.contains("__MISTY_POINTER_TRACKING_PLACEHOLDER__"));
        assert!(!script.contains("__MISTY_COMPANION_TOKEN_PLACEHOLDER__"));
        assert!(!script.contains("window.__MISTY_SHORTCUT_TOKEN"));
        assert!(BROWSER_COMPANION_SCRIPT.contains("window.__MISTY_SET_COMPANION__"));
    }

    #[test]
    fn forwarded_shortcuts_use_the_renderer_canonical_key_names() {
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("Period: 'Period'"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("NumpadAdd: 'Plus'"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("event.shiftKey && key !== 'Plus'"));
    }

    #[test]
    fn link_click_interception_opens_modifier_and_middle_clicks_in_new_window() {
        let script = browser_viewport_script("token", false);
        assert!(script.contains("const handleLinkClick"));
        assert!(script.contains("window.open(resolved, '_blank')"));
        assert!(script.contains("event.button === 1"));
        assert!(script.contains("event.metaKey || event.ctrlKey"));
    }

    #[test]
    fn pointer_tracking_can_be_enabled_for_an_active_companion() {
        let script = browser_viewport_script("token", true);
        assert!(script.contains("let pointerTrackingEnabled = true"));
        assert!(script.contains("window.__MISTY_SET_POINTER_TRACKING__"));
        assert!(script.contains("if (!pointerTrackingEnabled) return"));
    }

    #[test]
    fn embedded_pages_keep_their_native_focus_behavior() {
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("patchFocus"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("userInteracted"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("document.activeElement.blur()"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("report('default')"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("HTMLElement.prototype.click ="));
    }
}
