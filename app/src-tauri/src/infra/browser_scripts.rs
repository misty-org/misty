use url::Url;

pub(super) const BROWSER_VIEWPORT_SCRIPT: &str = r#"
(() => {
  const shortcutToken = __MISTY_SHORTCUT_TOKEN_PLACEHOLDER__;
  const install = () => {
    if (document.getElementById('misty-browser-viewport-style')) return;
    const style = document.createElement('style');
    style.id = 'misty-browser-viewport-style';
    style.textContent = 'html, body { overscroll-behavior: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };

  const allowed = new Set([
    'default', 'pointer', 'text', 'vertical-text', 'crosshair', 'move', 'grab', 'grabbing',
    'not-allowed', 'wait', 'help', 'zoom-in', 'zoom-out', 'col-resize', 'row-resize',
    'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize', 'nw-resize', 'se-resize',
    'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', 'copy', 'alias',
    'context-menu', 'cell', 'progress'
  ]);
  let lastCursor = '';
  let pendingEvent = null;
  let frame = 0;

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
      BracketRight: 'RightBracket', Comma: 'Comma', Equal: 'Plus', Minus: 'Minus',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown', PageUp: 'PageUp', PageDown: 'PageDown'
    })[key] || event.key;
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift',
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

  const semanticCursor = (target) => {
    if (!(target instanceof Element)) return 'default';
    const computed = getComputedStyle(target).cursor;
    if (allowed.has(computed)) return computed;
    if (target.closest('a[href], button, summary, select, [role="button"], [role="link"], [onclick]')) {
      return 'pointer';
    }
    const editable = target.closest('textarea, [contenteditable="true"], input');
    if (editable && !/^(button|checkbox|color|file|image|radio|range|reset|submit)$/i.test(editable.type || '')) {
      return 'text';
    }
    return 'default';
  };

  const report = (cursor) => {
    const normalized = allowed.has(cursor) ? cursor : 'default';
    if (normalized === lastCursor) return;
    lastCursor = normalized;
    const signal = document.createElement('a');
    signal.href = `misty-cursor:${normalized}`;
    signal.hidden = true;
    document.documentElement?.appendChild(signal);
    signal.click();
    signal.remove();
  };

  const flush = () => {
    frame = 0;
    if (pendingEvent) report(semanticCursor(pendingEvent.target));
    pendingEvent = null;
  };
  const track = (event) => {
    pendingEvent = event;
    if (!frame) frame = requestAnimationFrame(flush);
  };

  // Suppress automatic focus and suggestion popups prior to genuine user interaction.
  let userInteracted = false;
  const markInteraction = (event) => {
    if (event.isTrusted) userInteracted = true;
  };
  window.addEventListener('pointerdown', markInteraction, true);
  window.addEventListener('mousedown', markInteraction, true);
  window.addEventListener('keydown', markInteraction, true);
  window.addEventListener('touchstart', markInteraction, true);

  // Prevent initial focus events from triggering page suggestion listeners
  window.addEventListener('focusin', (event) => {
    if (!userInteracted) {
      event.stopImmediatePropagation();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (_) {}
      }
    }
  }, true);
  window.addEventListener('focus', (event) => {
    if (!userInteracted) {
      event.stopImmediatePropagation();
    }
  }, true);

  const patchFocus = (proto) => {
    if (!proto || typeof proto.focus !== 'function') return;
    const raw = proto.focus;
    proto.focus = function focus(...args) {
      if (!userInteracted) return;
      return raw.apply(this, args);
    };
  };
  patchFocus(window.HTMLElement?.prototype);
  patchFocus(window.Element?.prototype);
  patchFocus(window.HTMLInputElement?.prototype);
  patchFocus(window.HTMLTextAreaElement?.prototype);

  try {
    const stripAutofocus = (node) => {
      if (node && node.nodeType === 1) {
        if (node.hasAttribute('autofocus')) {
          node.removeAttribute('autofocus');
          node.autofocus = false;
        }
        const children = node.querySelectorAll?.('[autofocus]');
        if (children) {
          for (let i = 0; i < children.length; i++) {
            children[i].removeAttribute('autofocus');
            children[i].autofocus = false;
          }
        }
      }
    };
    const observer = new MutationObserver((mutations) => {
      if (userInteracted) {
        observer.disconnect();
        return;
      }
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          stripAutofocus(added[j]);
        }
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  } catch (_) {}

  const clearInitialAutofocus = () => {
    if (
      !userInteracted &&
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
    ) {
      try {
        document.activeElement.blur();
      } catch (_) {}
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', clearInitialAutofocus, { once: true });
    document.addEventListener('readystatechange', clearInitialAutofocus);
    window.addEventListener('load', clearInitialAutofocus, { once: true });
  } else {
    clearInitialAutofocus();
  }

  install();
  report('default');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
  document.addEventListener('pointerover', track, true);
  document.addEventListener('pointermove', track, true);
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) report('default');
  }, true);
  window.addEventListener('blur', () => report('default'));
})();
"#;

pub(super) fn browser_viewport_script(shortcut_token: &str) -> String {
    BROWSER_VIEWPORT_SCRIPT.replace(
        "__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__",
        &serde_json::to_string(shortcut_token).unwrap_or_else(|_| "\"\"".to_owned()),
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

pub(super) fn normalized_browser_cursor(value: &str) -> &'static str {
    match value {
        "pointer" => "pointer",
        "text" => "text",
        "vertical-text" => "vertical-text",
        "crosshair" => "crosshair",
        "move" => "move",
        "grab" => "grab",
        "grabbing" => "grabbing",
        "not-allowed" => "not-allowed",
        "wait" => "wait",
        "help" => "help",
        "zoom-in" => "zoom-in",
        "zoom-out" => "zoom-out",
        "col-resize" => "col-resize",
        "row-resize" => "row-resize",
        "n-resize" => "n-resize",
        "e-resize" => "e-resize",
        "s-resize" => "s-resize",
        "w-resize" => "w-resize",
        "ne-resize" => "ne-resize",
        "nw-resize" => "nw-resize",
        "se-resize" => "se-resize",
        "sw-resize" => "sw-resize",
        "ew-resize" => "ew-resize",
        "ns-resize" => "ns-resize",
        "nesw-resize" => "nesw-resize",
        "nwse-resize" => "nwse-resize",
        "copy" => "copy",
        "alias" => "alias",
        "context-menu" => "context-menu",
        "cell" => "cell",
        "progress" => "progress",
        _ => "default",
    }
}

pub(super) fn browser_cursor_navigation(url: &Url) -> Option<&'static str> {
    (url.scheme() == "misty-cursor")
        .then(|| normalized_browser_cursor(url.path().trim_start_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::{browser_viewport_script, BROWSER_VIEWPORT_SCRIPT};

    #[test]
    fn cursor_reporting_does_not_enable_remote_desktop_ipc() {
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("misty-cursor:"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("__TAURI_INTERNALS__"));
    }

    #[test]
    fn shortcut_token_is_embedded_as_json_without_becoming_a_window_global() {
        let script = browser_viewport_script("secret-token");
        assert!(script.contains("const shortcutToken = \"secret-token\""));
        assert!(script.contains("if (!event.isTrusted) return"));
        assert!(!script.contains("__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__"));
        assert!(!script.contains("window.__MISTY_SHORTCUT_TOKEN"));
    }

    #[test]
    fn initial_autofocus_is_suppressed_until_user_interaction() {
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("patchFocus(window.HTMLElement?.prototype)"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("userInteracted"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("if (event.isTrusted) userInteracted = true"));
        assert!(BROWSER_VIEWPORT_SCRIPT.contains("document.activeElement.blur()"));
        assert!(!BROWSER_VIEWPORT_SCRIPT.contains("HTMLElement.prototype.click ="));
    }
}
