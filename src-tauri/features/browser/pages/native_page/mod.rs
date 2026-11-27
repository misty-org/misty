use std::time::Duration;

use serde_json::Value;
use tauri::Webview;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(windows)]
use windows as platform;

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
const NOT_HERE: &str = "This system's browser can't do that.";

pub(crate) fn held_events() -> &'static tokio::sync::broadcast::Sender<()> {
    static EVENTS: std::sync::OnceLock<tokio::sync::broadcast::Sender<()>> =
        std::sync::OnceLock::new();
    EVENTS.get_or_init(|| tokio::sync::broadcast::channel(16).0)
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) fn dialog_held() {
    let _ = held_events().send(());
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
async fn answer<T: Send + 'static>(
    receiver: tokio::sync::oneshot::Receiver<Result<T, String>>,
    seconds: u64,
    what: &str,
) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(seconds), receiver)
        .await
        .map_err(|_| format!("{what} took too long."))?
        .map_err(|_| format!("{what} was cancelled."))?
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) fn reply<T: Send + 'static>(
) -> (impl FnOnce(Result<T, String>) + Send + 'static, tokio::sync::oneshot::Receiver<Result<T, String>>) {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(sender));
    (
        move |result| {
            if let Some(sender) = sender.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = sender.send(result);
            }
        },
        receiver,
    )
}

pub(crate) async fn capture(
    view: &Webview,
    region: [f64; 4],
    image_width: f64,
    lossless: bool,
) -> Result<Value, String> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let receiver = platform::capture(view, region, image_width, lossless)?;
        answer(receiver, 20, "The picture").await
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (view, region, image_width, lossless);
        Err(NOT_HERE.into())
    }
}

pub(crate) async fn cookies(view: &Webview, request: Value) -> Result<Value, String> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let receiver = platform::cookies(view, request)?;
        answer(receiver, 10, "Reading the cookies").await
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (view, request);
        Err(NOT_HERE.into())
    }
}

pub(crate) async fn emulate(view: &Webview, request: Value) -> Result<Value, String> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let receiver = platform::emulate(view, request)?;
        answer(receiver, 10, "Changing the view").await
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (view, request);
        Err(NOT_HERE.into())
    }
}

pub(crate) async fn pdf(view: &Webview) -> Result<Vec<u8>, String> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let receiver = platform::pdf(view)?;
        answer(receiver, 60, "The PDF").await
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = view;
        Err(NOT_HERE.into())
    }
}

pub(crate) fn set_zoom(view: &Webview, zoom: f64) -> Result<(), String> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        platform::set_zoom(view, zoom)
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (view, zoom);
        Err(NOT_HERE.into())
    }
}

pub(crate) const HOLDS_DIALOGS: bool = cfg!(any(target_os = "macos", windows, target_os = "linux"));

pub(crate) async fn hold_dialogs(view: &Webview, on: bool) {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    if let Ok(receiver) = platform::hold_dialogs(view, on) {
        let _ = answer(receiver, 10, "Holding dialogs").await;
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    let _ = (view, on);
}

pub(crate) async fn held_dialog(view: &Webview) -> Option<Value> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let receiver = platform::held_dialog(view).ok()?;
        answer(receiver, 10, "Reading the dialog").await.ok().flatten()
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = view;
        None
    }
}

pub(crate) async fn answer_dialog(view: &Webview, accept: bool, text: Option<String>) -> Option<Value> {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        let receiver = platform::answer_dialog(view, accept, text).ok()?;
        answer(receiver, 10, "Answering the dialog").await.ok().flatten()
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    {
        let _ = (view, accept, text);
        None
    }
}

#[cfg(any(windows, target_os = "linux"))]
pub(crate) const COOKIE_VALUE_LIMIT: usize = 4096;

#[cfg(any(windows, target_os = "linux"))]
pub(crate) fn clip(text: &str, most: usize) -> String {
    if text.len() <= most {
        return text.to_owned();
    }
    let mut end = most;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(any(windows, target_os = "linux"))]
pub(crate) fn cookie_applies(cookie: &Value, request: &Value, whole: bool) -> bool {
    if !whole {
        if let Some(name) = request["name"].as_str() {
            if cookie["name"].as_str() != Some(name) {
                return false;
            }
        }
        if let Some(path) = request["path"].as_str() {
            if cookie["path"].as_str() != Some(path) {
                return false;
            }
        }
    }
    match request["domain"].as_str() {
        Some(domain) => {
            let domain = domain.trim_start_matches('.').to_ascii_lowercase();
            let own = cookie["domain"].as_str().unwrap_or("").to_ascii_lowercase();
            let own = own.trim_start_matches('.');
            domain == own || domain.ends_with(&format!(".{own}"))
        }
        None => true,
    }
}

#[cfg(any(windows, target_os = "linux"))]
pub(crate) fn cookie_action(request: &Value) -> Result<&str, String> {
    let action = request["action"].as_str().unwrap_or("list");
    if !matches!(action, "list" | "get" | "set" | "delete" | "clear") {
        return Err("action is list, get, set, delete or clear.".into());
    }
    if action == "delete" && request["name"].as_str().is_none() {
        return Err("Name the cookie to delete.".into());
    }
    Ok(action)
}

#[cfg(any(windows, target_os = "linux"))]
pub(crate) fn same_site(request: &Value) -> Result<Option<&'static str>, String> {
    match request["sameSite"].as_str().map(str::to_ascii_lowercase).as_deref() {
        None => Ok(None),
        Some("lax") => Ok(Some("Lax")),
        Some("strict") => Ok(Some("Strict")),
        Some("none") => Ok(Some("None")),
        Some(_) => Err("sameSite is Lax, Strict or None.".into()),
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn data_url(bytes: &[u8], lossless: bool) -> String {
    use base64::Engine as _;
    format!(
        "data:image/{};base64,{}",
        if lossless { "png" } else { "jpeg" },
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(test)]
#[cfg(any(windows, target_os = "linux"))]
mod tests {
    use serde_json::json;

    #[test]
    fn cookies_are_picked_by_name_path_and_domain() {
        let cookie = json!({"name": "a", "path": "/", "domain": ".shop.example.com"});
        assert!(super::cookie_applies(&cookie, &json!({"name": "a"}), false));
        assert!(!super::cookie_applies(&cookie, &json!({"name": "b"}), false));
        assert!(super::cookie_applies(&cookie, &json!({"name": "b"}), true));
        assert!(super::cookie_applies(&cookie, &json!({"domain": "www.shop.example.com"}), false));
        assert!(!super::cookie_applies(&cookie, &json!({"domain": "example.com"}), false));
    }
}
