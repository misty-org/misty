//! Per-site restyling: a site's own CSS, hidden elements and a forced dark
//! mode, from the account setting `browser.siteStyles`. Applied to each page
//! when it finishes loading and to open pages whenever the styles change.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, Webview};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteStyle {
    pub host: String,
    #[serde(default)]
    pub css: String,
    #[serde(default)]
    pub dark: bool,
}

fn styles() -> &'static Mutex<HashMap<String, SiteStyle>> {
    static STYLES: OnceLock<Mutex<HashMap<String, SiteStyle>>> = OnceLock::new();
    STYLES.get_or_init(Mutex::default)
}

/// Inverts the page and turns media back, so light sites read dark.
const DARK_CSS: &str = "html{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}\
img,video,picture,canvas,iframe,svg image,[style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)!important}";

fn style_for(url: &url::Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    let styles = styles().lock().ok()?;
    // The most specific matching site wins: a.example.com before example.com.
    let style = styles
        .iter()
        .filter(|(site, _)| host == **site || host.ends_with(&format!(".{site}")))
        .max_by_key(|(site, _)| site.len())
        .map(|(_, style)| style.clone())?;
    let mut css = style.css;
    if style.dark {
        css.push('\n');
        css.push_str(DARK_CSS);
    }
    Some(css)
}

/// Replaces (or removes) the page's Misty style element. The CSS is passed as a
/// JSON string, so it can never break out of the script.
fn style_script(css: Option<&str>) -> String {
    let css = serde_json::Value::from(css.unwrap_or_default()).to_string();
    format!(
        "(() => {{ const css = {css}; let el = document.getElementById('misty-site-style'); \
         if (!css) {{ el?.remove(); return; }} \
         if (!el) {{ el = document.createElement('style'); el.id = 'misty-site-style'; }} \
         el.textContent = css; (document.head || document.documentElement).append(el); }})();"
    )
}

static GESTURES: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Mouse gestures (Settings › Browsing), checked again when a page reports one.
pub(crate) fn gestures_enabled() -> bool {
    GESTURES.load(std::sync::atomic::Ordering::Relaxed)
}

/// Called when a page finishes loading: its site's style, and whether mouse
/// gestures are on (pages start with them off).
pub(crate) fn apply(webview: &Webview) {
    let _ = webview.eval(format!(
        "window.__MISTY_SET_GESTURES__?.({});",
        gestures_enabled()
    ));
    let Ok(url) = webview.url() else { return };
    let css = style_for(&url);
    let _ = webview.eval(style_script(css.as_deref()));
}

/// Mouse gestures, from the account setting. Applies to open pages at once.
#[tauri::command]
pub fn browser_set_mouse_gestures(app: tauri::AppHandle, enabled: bool) {
    GESTURES.store(enabled, std::sync::atomic::Ordering::Relaxed);
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            let _ = webview.eval(format!("window.__MISTY_SET_GESTURES__?.({enabled});"));
        }
    }
}

#[tauri::command]
pub fn browser_set_site_styles(app: tauri::AppHandle, sites: Vec<SiteStyle>) -> Result<(), String> {
    if sites.len() > 500 {
        return Err("Too many sites have custom styles.".into());
    }
    let next: HashMap<String, SiteStyle> = sites
        .into_iter()
        .filter(|style| {
            !style.host.is_empty() && style.host.len() <= 253 && style.css.len() <= 32_768
        })
        .map(|style| (style.host.to_ascii_lowercase(), style))
        .collect();
    *styles()
        .lock()
        .map_err(|_| "Site styles are unavailable.")? = next;
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            apply(&webview);
        }
    }
    Ok(())
}

/// Lets the person click the element to hide. Resolves with a CSS selector for
/// it, or nothing when they press Escape or wait too long.
const PICKER_SCRIPT: &str = r#"(() => {
  if (window.__MISTY_PICKING__) return;
  window.__MISTY_PICKING__ = true;
  window.__MISTY_PICKED__ = undefined;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #f2f2f2;background:rgba(242,242,242,.15);border-radius:4px;transition:all .05s';
  document.documentElement.append(box);
  let current = null;
  const selector = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift('#' + node.id); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const done = (value) => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', key, true);
    box.remove();
    window.__MISTY_PICKING__ = false;
    window.__MISTY_PICKED__ = value;
  };
  const move = (event) => {
    current = event.target instanceof Element ? event.target : null;
    if (!current) return;
    const r = current.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const click = (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    done(current ? selector(current) : '');
  };
  const key = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); done(''); }
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', key, true);
})()"#;

/// Waits for the person to pick an element in the page, up to a minute.
pub(crate) async fn pick_element(webview: &Webview) -> Result<Option<String>, String> {
    webview.eval(PICKER_SCRIPT).map_err(|e| e.to_string())?;
    for _ in 0..240 {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let (send, receive) = tokio::sync::oneshot::channel();
        let send = Mutex::new(Some(send));
        webview
            .eval_with_callback("window.__MISTY_PICKED__ ?? null", move |value| {
                if let Some(send) = send.lock().ok().and_then(|mut send| send.take()) {
                    let _ = send.send(value);
                }
            })
            .map_err(|e| e.to_string())?;
        let value = tokio::time::timeout(std::time::Duration::from_secs(2), receive)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or_default();
        match serde_json::from_str::<Option<String>>(&value) {
            Ok(Some(selector)) if selector.is_empty() => return Ok(None),
            Ok(Some(selector)) if selector.len() <= 1024 => return Ok(Some(selector)),
            Ok(Some(_)) => return Ok(None),
            _ => {}
        }
    }
    let _ = webview.eval("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    Ok(None)
}

#[tauri::command]
pub async fn browser_webview_pick_element(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<String>, String> {
    let label = format!("misty-browser-{id}");
    if id.is_empty()
        || id.len() > 96
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Browser tab identifier is invalid.".into());
    }
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    pick_element(&webview).await
}
