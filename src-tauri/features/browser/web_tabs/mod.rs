use crate::browser::*;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

mod page_tools;
mod site_permissions;
mod suggest;

pub use page_tools::*;
pub use site_permissions::*;
pub use suggest::*;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub(in crate::browser) use macos::page_failed;

pub(in crate::browser) const WEB_TAB_SCOPE: &str = "web-scope-";

fn pages() -> &'static Mutex<HashMap<usize, String>> {
    static PAGES: OnceLock<Mutex<HashMap<usize, String>>> = OnceLock::new();
    PAGES.get_or_init(Mutex::default)
}

fn page_of_view(view: usize) -> Option<String> {
    pages().lock().ok()?.get(&view).cloned()
}

static APP: OnceLock<AppHandle> = OnceLock::new();

fn app() -> Option<&'static AppHandle> {
    APP.get()
}

pub(in crate::browser) fn install(
    app: &AppHandle,
    webview: &Webview,
    id: &str,
    scope_id: &str,
) -> Result<(), String> {
    if !scope_id.starts_with(WEB_TAB_SCOPE) {
        return Ok(());
    }
    let _ = APP.set(app.clone());
    #[cfg(target_os = "macos")]
    {
        let id = id.to_owned();
        webview
            .with_webview(move |native| {
                let view = native.inner() as usize;
                if let Ok(mut pages) = pages().lock() {
                    pages.retain(|_, page| *page != id);
                    pages.insert(view, id);
                }
                unsafe { macos::install_permissions(view) };
            })
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (webview, id);
    Ok(())
}

fn running(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}

async fn page_value(webview: &Webview, script: String, wait: Duration) -> Result<String, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(script, move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(value);
            }
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(wait, receiver)
        .await
        .map_err(|_| "The page did not respond.".to_owned())?
        .map_err(|_| "The page closed before it responded.".to_owned())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageFailedEvent {
    id: String,
    url: String,
    offline: bool,
    message: String,
}

fn emit_failed(id: &str, url: String, offline: bool, message: String) {
    let Some(app) = app() else { return };
    let _ = app.emit_to(
        browser_owner_label(app, id),
        "misty://browser-page-failed",
        PageFailedEvent {
            id: id.to_owned(),
            url,
            offline,
            message,
        },
    );
}
