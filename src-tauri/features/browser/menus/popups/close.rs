use super::*;

pub(super) fn close_after_download_wait(app: &AppHandle, id: String) {
    let cleanup_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(100)).await;
        let _ = close_browser_webview(
            cleanup_app.clone(),
            cleanup_app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        );
    });
}

fn close_from_page(app: AppHandle, id: String) {
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
pub(in crate::browser) fn forget_close_handler(_id: &str) {}

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
pub(in crate::browser) fn forget_close_handler(id: &str) {
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
            let _: () =
                msg_send![view, setUIDelegate: std::ptr::null_mut::<objc::runtime::Object>()];
            let _: () = msg_send![view, setUIDelegate: delegate];
            if let Ok(mut targets) = close_targets().lock() {
                targets.insert(view as usize, (app, id));
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
pub(super) fn install_close_handler(
    app: &AppHandle,
    webview: &Webview,
    id: &str,
) -> Result<(), String> {
    use webkit2gtk::WebViewExt;
    let app = app.clone();
    let id = id.to_owned();
    webview
        .with_webview(move |native| {
            native.inner().connect_close(move |_| {
                close_from_page(app.clone(), id.clone());
            });
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
pub(in crate::browser) fn forget_close_handler(_id: &str) {}
