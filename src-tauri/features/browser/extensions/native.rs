// SPDX-License-Identifier: MIT
use serde_json::Value;
use tauri::Manager;

#[cfg(target_os = "macos")]
use super::macos;
#[cfg(target_os = "macos")]
mod callbacks;

static SYNC_EVENTS: std::sync::OnceLock<tokio::sync::mpsc::UnboundedSender<Value>> =
    std::sync::OnceLock::new();
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub(super) fn app() -> Option<&'static tauri::AppHandle> {
    APP.get()
}

pub fn initialize(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    SYNC_EVENTS.get_or_init(|| {
        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = receive.recv().await {
                super::sync::observe(&app, event).await;
            }
        });
        send
    });
    #[cfg(target_os = "macos")]
    {
        macos::set_events(callbacks::event);
        // Compat requests ride Kiri's extension transport.
        kiri::extensions::bridge::set_extension_channel(callbacks::CompatHost);
        macos::set_compat_channel(callbacks::install_compat_channel);
        macos::set_navigation_policy(callbacks::navigation_policy);
        wry::set_native_navigation_interceptor(callbacks::navigation_interceptor);
    }
}

pub async fn request(value: Value) -> Result<Value, String> {
    // Account teardown also runs before the application has initialized any
    // extension host (and in headless lifecycle tests). Do not queue a callback
    // on a main run loop that does not exist yet.
    if APP.get().is_none() {
        return Err("The extension runtime has not initialized.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel::<Value>();
        macos::request(
            value,
            Box::new(move |result| {
                let _ = send.send(result);
            }),
        );
        let value = tokio::time::timeout(std::time::Duration::from_secs(45), receive)
            .await
            .map_err(|_| "The extension runtime did not respond.")?
            .map_err(|_| "The extension runtime stopped.")?;
        if let Some(error) = value["error"].as_str() {
            return Err(error.into());
        }
        Ok(value)
    }
    #[cfg(windows)]
    {
        crate::browser::extensions::native::windows::request(value).await
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = value;
        Err("Extensions require macOS 15.4 or later, or Windows.".into())
    }
}

/// The profile a browser page belongs to, from the window that holds it.
pub fn page_profile(app: &tauri::AppHandle, id: &str) -> Option<String> {
    let view = app.get_webview(&format!("misty-browser-{id}"))?;
    crate::browser::app_windows::profile_for_owner(view.window().label())
}

/// `profile` is the page's profile; `None` lets the host that knows the tab answer
/// (a closing page whose window is already gone).
pub fn tab_event(app: &tauri::AppHandle, profile: Option<&str>, id: &str, event: &str) {
    #[cfg(target_os = "macos")]
    {
        let (profile, id, event) = (
            profile.unwrap_or_default().to_owned(),
            id.to_owned(),
            event.to_owned(),
        );
        let _ = app.run_on_main_thread(move || macos::tab_event(&profile, &id, &event));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, profile, id, event);
}

pub fn register(view: &tauri::Webview, profile: &str, id: &str, private: bool, url: &str) {
    #[cfg(target_os = "macos")]
    {
        let (profile, id, url) = (profile.to_owned(), id.to_owned(), url.to_owned());
        let _ = view.with_webview(move |platform| {
            // SAFETY: Tauri hands over the page's live WKWebView, on the main thread.
            let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
            macos::register_tab(&profile, view, &id, private, &url);
        });
    }
    #[cfg(windows)]
    crate::browser::extensions::native::windows::register(view);
    #[cfg(not(target_os = "macos"))]
    let _ = (view, profile, id, private, url);
}

/// A page configuration wired to its profile's extension controller.
#[cfg(target_os = "macos")]
pub async fn configuration(
    app: &tauri::AppHandle,
    profile: &str,
    store_identifier: [u8; 16],
    private: bool,
    url: String,
) -> Result<Option<usize>, String> {
    let profile = profile.to_owned();
    if !macos::supported() {
        return Ok(None);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        use objc2::{rc::Retained, MainThreadMarker};
        use objc2_foundation::NSUUID;
        use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
        let result = (|| {
            let mtm = MainThreadMarker::new()
                .ok_or("Extension configuration requires the main thread.")?;
            let config = unsafe { WKWebViewConfiguration::new(mtm) };
            // Incognito windows have no extension host; their pages never get here.
            if private {
                return Err("Extensions don't run in incognito windows.".to_owned());
            }
            let store = unsafe {
                WKWebsiteDataStore::dataStoreForIdentifier(
                    &NSUUID::from_bytes(store_identifier),
                    mtm,
                )
            };
            unsafe {
                config.setWebsiteDataStore(&store);
            }
            // The caller owns the retained configuration this returns.
            Ok::<_, String>(
                macos::configuration(mtm, &profile, &config, &url)
                    .map(|configuration| Retained::into_raw(configuration) as usize),
            )
        })();
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "Extension configuration was cancelled.")?
}

/// The profile whose extensions a caller manages: its own profile window's. Only profile
/// windows manage extensions; incognito windows have none.
pub fn caller_profile(view: &tauri::Webview) -> Result<String, String> {
    let label = view.window().label().to_owned();
    if crate::browser::app_windows::is_person_window(&label) {
        crate::browser::app_windows::profile_for_window(&label)
            .ok_or_else(|| "Only the Misty workspace can manage extensions.".into())
    } else {
        Err("Only the Misty workspace can manage extensions.".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod checks;
#[cfg(windows)]
pub(crate) mod windows;

/// The scheme extension pages load from: WebKit's on macOS, Chromium's in
/// WebView2 on Windows.
pub(crate) const EXTENSION_SCHEME: &str = if cfg!(windows) {
    "chrome-extension"
} else {
    "webkit-extension"
};

/// The host an extension's pages load from, for its account origin. WebKit
/// uses the origin itself; WebView2 uses the extension ID that the manifest
/// key Misty derives from the origin gives it.
pub(crate) fn page_host(origin: &str) -> Option<String> {
    #[cfg(windows)]
    return crate::browser::extensions::native::windows::page_host(origin);
    #[cfg(not(windows))]
    Some(origin.to_owned())
}
