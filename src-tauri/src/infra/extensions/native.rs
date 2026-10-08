// SPDX-License-Identifier: MIT
use serde_json::Value;
use std::ffi::{c_char, c_void, CStr, CString};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
extern "C" {
    fn misty_extensions_request(
        json: *const c_char,
        reply: extern "C" fn(*mut c_void, *const c_char),
        context: *mut c_void,
    );
    fn misty_extensions_set_events(callback: extern "C" fn(*const c_char));
    fn misty_extensions_configuration(
        configuration: *mut c_void,
        url: *const c_char,
        default_store: bool,
    ) -> *mut c_void;
    fn misty_extensions_register_tab(
        webview: *mut c_void,
        identifier: *const c_char,
        private_tab: bool,
        url: *const c_char,
    );
    fn misty_extensions_navigation(view: *mut c_void, action: *mut c_void) -> bool;
    fn misty_extensions_set_compat_channel(install: extern "C" fn(*mut c_void));
    fn misty_extensions_compat_message(message: *mut c_void, reply: *mut c_void);
    fn misty_extensions_supported() -> bool;
    fn misty_extensions_tab_event(identifier: *const c_char, event: *const c_char);
}

static SYNC_EVENTS: std::sync::OnceLock<tokio::sync::mpsc::UnboundedSender<Value>> =
    std::sync::OnceLock::new();
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();
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
    unsafe {
        misty_extensions_set_events(event);
        // Compat requests ride Kiri's extension transport.
        kiri::extensions::bridge::set_extension_channel(CompatHost);
        misty_extensions_set_compat_channel(install_compat_channel);
        wry::set_native_navigation_interceptor(|view, action| {
            misty_extensions_navigation(view, action)
        });
    }
}

#[cfg(target_os = "macos")]
extern "C" fn install_compat_channel(controller: *mut c_void) {
    unsafe { kiri::extensions::bridge::install(controller) }
}

/// The native extension host answers what Kiri's transport admits.
#[cfg(target_os = "macos")]
struct CompatHost;

#[cfg(target_os = "macos")]
impl kiri::extensions::bridge::ExtensionChannel for CompatHost {
    unsafe fn receive(&self, message: *mut c_void, reply: *mut c_void) {
        misty_extensions_compat_message(message, reply);
    }
}

#[cfg(target_os = "macos")]
extern "C" fn event(pointer: *const c_char) {
    if pointer.is_null() {
        return;
    }
    let Ok(value) = serde_json::from_slice::<Value>(unsafe { CStr::from_ptr(pointer).to_bytes() })
    else {
        return;
    };
    let Some(app) = APP.get() else {
        return;
    };
    // Storage payloads never enter renderer event channels.
    if value["kind"]
        .as_str()
        .is_some_and(|kind| kind.starts_with("sync-"))
    {
        if let Some(send) = SYNC_EVENTS.get() {
            let _ = send.send(value);
        }
    } else if value["kind"] == "replace-view" {
        let app = app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(id) = value["tabId"].as_str() {
                if let Some(view) = app.get_webview(&format!("misty-browser-{id}")) {
                    let _ = view.close();
                }
            }
            let _ = app.emit_to("main", "misty://extensions", value);
        });
    } else {
        if value["kind"] == "runtime-error" {
            let event = value.clone();
            tauri::async_runtime::spawn(async move {
                let mut state = super::service().lock().await;
                if event["account"].as_str() == Some(&state.account) {
                    if let Some(status) = event["id"]
                        .as_str()
                        .and_then(|id| id.parse::<u64>().ok())
                        .and_then(|id| state.states.get_mut(&id))
                    {
                        status.detail = event["detail"]
                            .as_str()
                            .filter(|v| !v.is_empty())
                            .map(str::to_owned);
                        status.status = if status.detail.is_some() {
                            "needs-attention"
                        } else {
                            "enabled"
                        }
                        .into();
                    }
                }
            });
        }
        let _ = app.emit_to("main", "misty://extensions", value);
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
        type Sender = tokio::sync::oneshot::Sender<Result<Value, String>>;
        extern "C" fn reply(context: *mut c_void, pointer: *const c_char) {
            let sender = unsafe { Box::from_raw(context.cast::<Sender>()) };
            let result = if pointer.is_null() {
                Err("Extension runtime returned no result.".into())
            } else {
                serde_json::from_slice::<Value>(unsafe { CStr::from_ptr(pointer).to_bytes() })
                    .map_err(|_| "Invalid extension runtime result.".into())
            };
            let _ = sender.send(result);
        }
        let (send, receive) = tokio::sync::oneshot::channel::<Result<Value, String>>();
        let json = CString::new(value.to_string()).map_err(|_| "Invalid extension request.")?;
        unsafe {
            misty_extensions_request(json.as_ptr(), reply, Box::into_raw(Box::new(send)).cast());
        }
        let value = tokio::time::timeout(std::time::Duration::from_secs(45), receive)
            .await
            .map_err(|_| "The extension runtime did not respond.")?
            .map_err(|_| "The extension runtime stopped.")??;
        if let Some(error) = value["error"].as_str() {
            return Err(error.into());
        }
        Ok(value)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = value;
        Err("Extensions require macOS 15.4 or later.".into())
    }
}

pub fn tab_event(app: &tauri::AppHandle, id: &str, event: &str) {
    #[cfg(target_os = "macos")]
    if let (Ok(id), Ok(event)) = (CString::new(id), CString::new(event)) {
        let _ = app.run_on_main_thread(move || unsafe {
            misty_extensions_tab_event(id.as_ptr(), event.as_ptr());
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, id, event);
}

pub fn register(view: &tauri::Webview, id: &str, private: bool, url: &str) {
    #[cfg(target_os = "macos")]
    if let (Ok(id), Ok(url)) = (CString::new(id), CString::new(url)) {
        let _ = view.with_webview(move |platform| unsafe {
            misty_extensions_register_tab(
                platform.inner().cast(),
                id.as_ptr(),
                private,
                url.as_ptr(),
            );
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (view, id, private, url);
}

#[cfg(target_os = "macos")]
pub async fn configuration(
    app: &tauri::AppHandle,
    profile: [u8; 16],
    private: bool,
    url: String,
    default_store: bool,
) -> Result<Option<usize>, String> {
    if !unsafe { misty_extensions_supported() } {
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
            let store = if private {
                wry::extension_private_data_store(mtm)
            } else {
                unsafe {
                    WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(profile), mtm)
                }
            };
            unsafe {
                config.setWebsiteDataStore(&store);
            }
            let url = CString::new(url).map_err(|_| "Invalid browser URL.")?;
            let pointer = unsafe {
                misty_extensions_configuration(
                    Retained::as_ptr(&config).cast_mut().cast(),
                    url.as_ptr(),
                    default_store,
                )
            };
            Ok::<_, String>((!pointer.is_null()).then_some(pointer as usize))
        })();
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "Extension configuration was cancelled.")?
}

pub fn trusted(view: &tauri::Webview) -> Result<(), String> {
    if view.label() == "main" {
        Ok(())
    } else {
        Err("Only the Misty workspace can manage extensions.".into())
    }
}
