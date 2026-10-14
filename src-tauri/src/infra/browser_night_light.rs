//! Night light for browser pages (Settings › Appearance). Pages are native views
//! above the app's own, so they get the same warm multiply layer the app draws
//! over its window: when each page finishes loading, and on open pages whenever
//! the tint changes.

use std::sync::Mutex;
use tauri::{Manager, Webview};

static TINT: Mutex<Option<String>> = Mutex::new(None);

fn valid_tint(tint: &str) -> bool {
    tint.len() == 7 && tint.starts_with('#') && tint[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Replaces (or removes) the page's night light style element. The CSS is
/// passed as a JSON string, so it can never break out of the script.
fn night_light_script(tint: Option<&str>) -> String {
    let css = tint
        .map(|tint| {
            format!(
                "html::after{{content:\"\"!important;position:fixed!important;inset:0!important;\
                 z-index:2147483647!important;pointer-events:none!important;\
                 background:{tint}!important;mix-blend-mode:multiply!important}}"
            )
        })
        .unwrap_or_default();
    let css = serde_json::Value::from(css).to_string();
    format!(
        "(() => {{ const css = {css}; let el = document.getElementById('misty-night-light'); \
         if (!css) {{ el?.remove(); return; }} \
         if (!el) {{ el = document.createElement('style'); el.id = 'misty-night-light'; }} \
         el.textContent = css; (document.head || document.documentElement).append(el); }})();"
    )
}

/// Called when a page finishes loading.
pub(crate) fn apply(webview: &Webview) {
    let tint = TINT.lock().ok().and_then(|tint| tint.clone());
    let _ = webview.eval(night_light_script(tint.as_deref()));
}

/// The night light tint as "#rrggbb", or none when it is off. Applies to open
/// pages at once.
#[tauri::command]
pub fn browser_set_night_light(app: tauri::AppHandle, tint: Option<String>) -> Result<(), String> {
    if tint.as_deref().is_some_and(|tint| !valid_tint(tint)) {
        return Err("Night light color is invalid.".into());
    }
    *TINT.lock().map_err(|_| "Night light is unavailable.")? = tint;
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            apply(&webview);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_hex_tints() {
        assert!(valid_tint("#ffc58d"));
        assert!(!valid_tint("ffc58d"));
        assert!(!valid_tint("#ffc58d;}"));
        assert!(!valid_tint("red"));
    }

    #[test]
    fn off_removes_the_layer() {
        assert!(night_light_script(None).contains("const css = \"\";"));
        assert!(night_light_script(Some("#ffc58d")).contains("background:#ffc58d"));
    }
}
