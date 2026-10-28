use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

/// The top document's page script; `browser_viewport_script` fills its placeholders.
pub(super) const BROWSER_VIEWPORT_SCRIPT: &str = concat!("\n", include_str!("viewport.js"));

pub(super) fn browser_viewport_script(
    shortcut_token: &str,
    pointer_tracking: bool,
    bindings: &[super::super::browser_shortcuts::BrowserShortcutBinding],
) -> String {
    let bindings_json = serde_json::to_string(bindings).unwrap_or_else(|_| "[]".to_owned());
    BROWSER_VIEWPORT_SCRIPT
        .replace("__MISTY_MEDIA_PLACEHOLDER__", include_str!("media.js"))
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
