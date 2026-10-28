//! Closing a popup: when its page asks to, and when no tab adopted it in time.
use super::*;

/// A popup no tab adopted is dropped after a while, with its session and token.
/// Export popups may wait longer, for the download the source expects.
pub(super) fn expire_unadopted(app: &AppHandle, id: String, label: String, agent_download: bool) {
    let cleanup_app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Export popups may spend time generating a file before it downloads.
        // Keep the view alive through the source's bounded download wait.
        tokio::time::sleep(Duration::from_secs(if agent_download { 100 } else { 30 })).await;
        let state = cleanup_app.state::<BrowserSessionState>();
        let pending = state
            .pending_popups
            .lock()
            .map(|mut pending| pending.remove(&id))
            .unwrap_or(false);
        if pending {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&id);
            }
            forget_shortcut_token(&state, &id);
            if let Some(window) = cleanup_app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    });
}

/// Closes the popup's tab the way the tab strip would, once the page itself
/// asks to close (OAuth popups do this when they finish).
fn close_from_page(app: AppHandle, id: String) {
    // Leave the engine's callback before destroying its window and view.
    tauri::async_runtime::spawn(async move {
        let close_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = close_browser_webview(
                close_app.clone(),
                close_app.state::<BrowserSessionState>(),
                BrowserWebviewIdRequest { id },
            );
        });
    });
}

/// WebView2 reports `window.close()` as WindowCloseRequested.
#[cfg(windows)]
pub(super) fn install_close_handler(
    app: &AppHandle,
    webview: &Webview,
    id: &str,
) -> Result<(), String> {
    use webview2_com::WindowCloseRequestedEventHandler;
    let app = app.clone();
    let id = id.to_owned();
    webview
        .with_webview(move |native| {
            // SAFETY: the controller is live during this UI-thread callback; the
            // handler owns clones of the app handle and tab id.
            let _ = unsafe {
                native.controller().CoreWebView2().and_then(|core| {
                    let mut token = Default::default();
                    core.add_WindowCloseRequested(
                        &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                            close_from_page(app.clone(), id.clone());
                            Ok(())
                        })),
                        &mut token,
                    )
                })
            };
        })
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
pub(in crate::infra::browser) fn forget_close_handler(_id: &str) {}

// Wry 0.55 supplies popup creation but omits WKUIDelegate.webViewDidClose.
// Handle WebKit's actual close notification, including OAuth completion, without
// injecting a replacement window.close or guessing which URL means success.
#[cfg(target_os = "macos")]
use std::sync::OnceLock;
#[cfg(target_os = "macos")]
type CloseTarget = (AppHandle, String);
#[cfg(target_os = "macos")]
static CLOSE_TARGETS: OnceLock<Mutex<HashMap<usize, CloseTarget>>> = OnceLock::new();
#[cfg(target_os = "macos")]
fn close_targets() -> &'static Mutex<HashMap<usize, CloseTarget>> {
    CLOSE_TARGETS.get_or_init(Mutex::default)
}
#[cfg(target_os = "macos")]
pub(in crate::infra::browser) fn forget_close_handler(id: &str) {
    if let Ok(mut targets) = close_targets().lock() {
        targets.retain(|_, (_, target)| target != id);
    }
}
#[cfg(target_os = "macos")]
extern "C" fn webview_did_close(
    _delegate: &objc::runtime::Object,
    _selector: objc::runtime::Sel,
    view: *mut objc::runtime::Object,
) {
    let target = close_targets()
        .lock()
        .ok()
        .and_then(|targets| targets.get(&(view as usize)).cloned());
    if let Some((app, id)) = target {
        close_from_page(app, id);
    }
}
#[cfg(target_os = "macos")]
pub(super) fn install_close_handler(
    app: &AppHandle,
    webview: &Webview,
    id: &str,
) -> Result<(), String> {
    use objc::{msg_send, sel, sel_impl};
    let app = app.clone();
    let id = id.to_owned();
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut objc::runtime::Object;
            let delegate: *mut objc::runtime::Object = msg_send![view, UIDelegate];
            // Add a same-layout subclass so existing file dialogs and popup handling
            // continue to use Wry's delegate; only this window gains the close hook.
            let class_name = "MistyIntegrationPopupUIDelegate";
            let subclass = objc::runtime::Class::get(class_name).unwrap_or_else(|| {
                let mut declaration =
                    objc::declare::ClassDecl::new(class_name, (*delegate).class())
                        .expect("unique popup delegate class");
                declaration.add_method(
                    sel!(webViewDidClose:),
                    webview_did_close
                        as extern "C" fn(
                            &objc::runtime::Object,
                            objc::runtime::Sel,
                            *mut objc::runtime::Object,
                        ),
                );
                declaration.register()
            });
            unsafe extern "C" {
                fn object_setClass(
                    object: *mut objc::runtime::Object,
                    class: *const objc::runtime::Class,
                ) -> *const objc::runtime::Class;
            }
            object_setClass(delegate, subclass);
            // WebKit caches optional delegate selectors when the delegate is set.
            // Reassign it after adding webViewDidClose so the new method is observed.
            let _: () =
                msg_send![view, setUIDelegate: std::ptr::null_mut::<objc::runtime::Object>()];
            let _: () = msg_send![view, setUIDelegate: delegate];
            if let Ok(mut targets) = close_targets().lock() {
                targets.insert(view as usize, (app, id));
            }
        })
        .map_err(|error| error.to_string())
}
