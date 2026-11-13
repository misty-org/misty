use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// The top document's page script; `browser_viewport_script` fills its placeholders.
pub(in crate::browser) const BROWSER_VIEWPORT_SCRIPT: &str =
    concat!("\n", include_str!("viewport.js"));

pub(in crate::browser) fn browser_viewport_script(
    shortcut_token: &str,
    pointer_tracking: bool,
    bindings: &[crate::browser::input::shortcuts::BrowserShortcutBinding],
) -> String {
    let bindings_json = serde_json::to_string(bindings).unwrap_or_else(|_| "[]".to_owned());
    BROWSER_VIEWPORT_SCRIPT
        .replace(
            "__MISTY_WINDOW_DRAG_PLACEHOLDER__",
            include_str!("window_drag.js"),
        )
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
            "__MISTY_CARET_PLACEHOLDER__",
            if cfg!(target_os = "macos") {
                include_str!("caret.js")
            } else {
                ""
            },
        )
        .replace(
            "__MISTY_FULLSCREEN_PLACEHOLDER__",
            if cfg!(windows) {
                include_str!("fullscreen.js")
            } else {
                ""
            },
        )
        .replace(
            "__MISTY_CONTEXT_MENU_PLACEHOLDER__",
            include_str!("context_menu.js"),
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

/// The tab's token authenticates the Escape-to-stop report on Kiri's host channel.
pub(in crate::browser) fn browser_status_script(shortcut_token: &str) -> String {
    include_str!("status.js")
        // Pages always show the hovered-link and loading bubble.
        .replace("__MISTY_STATUS_ENABLED_PLACEHOLDER__", "true")
        .replace(
            "__KIRI_HOST_SENDER_PLACEHOLDER__",
            kiri::channel::sender_script(),
        )
        .replace(
            "__MISTY_STATUS_TOKEN_PLACEHOLDER__",
            &serde_json::to_string(shortcut_token).unwrap_or_else(|_| "\"\"".to_owned()),
        )
}

pub(in crate::browser) fn browser_status_update_script(state: &serde_json::Value) -> String {
    format!("window.__MISTY_SET_STATUS__?.({state});")
}

pub(in crate::browser) const BROWSER_FAVICON_SCRIPT: &str = r#"
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

pub(in crate::browser) const BROWSER_COMPATIBILITY_SCRIPT: &str = r#"
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
pub(in crate::browser) struct BrowserPointerNavigation {
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

pub(in crate::browser) fn emit_browser_pointer(
    app: &AppHandle,
    id: &str,
    pointer: BrowserPointerNavigation,
) {
    let _ = app.emit_to(
        crate::browser::browser_owner_label(app, id),
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
