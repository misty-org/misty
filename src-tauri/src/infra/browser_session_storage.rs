//! One-navigation sessionStorage bootstrap. The script is removed after the
//! first real document load, so later reloads never resurrect an old token.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;
use zeroize::Zeroizing;
struct Installed {
    source: Zeroizing<String>,
    platform_id: String,
}
static SCRIPTS: OnceLock<Mutex<HashMap<String, Installed>>> = OnceLock::new();
fn scripts() -> &'static Mutex<HashMap<String, Installed>> {
    SCRIPTS.get_or_init(Mutex::default)
}

pub(super) async fn install(
    view: &Webview,
    origin: &str,
    values: &serde_json::Value,
) -> Result<(), String> {
    let origin = serde_json::to_string(origin).map_err(|_| "Invalid session origin")?;
    let values = serde_json::to_string(values).map_err(|_| "Invalid tab session")?;
    let source = Zeroizing::new(format!("(() => {{ if (window !== top || location.origin !== {origin}) return; const values = {values}; for (const key of Object.keys(sessionStorage)) if (!Object.hasOwn(values, key)) sessionStorage.removeItem(key); for (const [key,value] of Object.entries(values)) sessionStorage.setItem(key,value); }})();"));
    let id = install_native(view, source.to_string()).await?;
    scripts()
        .lock()
        .map_err(|_| "Session bootstrap is unavailable")?
        .insert(
            view.label().into(),
            Installed {
                source,
                platform_id: id,
            },
        );
    Ok(())
}

pub(super) fn clear(view: &Webview) {
    let Some(script) = scripts()
        .lock()
        .ok()
        .and_then(|mut scripts| scripts.remove(view.label()))
    else {
        return;
    };
    let _ = view.with_webview(move |platform| {
        #[cfg(target_os = "macos")]
        unsafe {
            let view: &objc2_web_kit::WKWebView = &*platform.inner().cast();
            let controller = view.configuration().userContentController();
            let previous = controller.userScripts();
            controller.removeAllUserScripts();
            for current in previous.iter() {
                if current.source().to_string() != script.source.as_str() {
                    controller.addUserScript(&current);
                }
            }
        }
        #[cfg(windows)]
        unsafe {
            if let Ok(view) = platform.controller().CoreWebView2() {
                let _ = view.RemoveScriptToExecuteOnDocumentCreated(&windows::core::HSTRING::from(
                    script.platform_id.as_str(),
                ));
            }
        }
        let _ = (&script.source, &script.platform_id);
    });
}

async fn install_native(view: &Webview, source: String) -> Result<String, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    #[cfg(target_os = "macos")]
    view.with_webview(move |platform| unsafe {
        use objc2::{MainThreadMarker, MainThreadOnly};
        use objc2_foundation::NSString;
        use objc2_web_kit::{WKUserScript, WKUserScriptInjectionTime, WKWebView};
        let result = (|| {
            let marker =
                MainThreadMarker::new().ok_or("Session bootstrap requires the main thread")?;
            let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                WKUserScript::alloc(marker),
                &NSString::from_str(&source),
                WKUserScriptInjectionTime::AtDocumentStart,
                true,
            );
            let view: &WKWebView = &*platform.inner().cast();
            view.configuration()
                .userContentController()
                .addUserScript(&script);
            Ok(String::new())
        })();
        let _ = send.send(result);
    })
    .map_err(|_| "Could not prepare tab session")?;
    #[cfg(windows)]
    view.with_webview(move |platform| unsafe {
        use std::sync::Arc;
        use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
        let send = Arc::new(Mutex::new(Some(send)));
        let reply = send.clone();
        let callback = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
            move |status, id| {
                if let Some(send) = reply.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = send.send(if status.is_ok() {
                        Ok(id)
                    } else {
                        Err("Could not prepare tab session")
                    });
                }
                Ok(())
            },
        ));
        let result = platform.controller().CoreWebView2().and_then(|view| {
            view.AddScriptToExecuteOnDocumentCreated(
                &windows::core::HSTRING::from(source.as_str()),
                &callback,
            )
        });
        if result.is_err() {
            if let Some(send) = send.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = send.send(Err("Could not prepare tab session"));
            }
        }
    })
    .map_err(|_| "Could not prepare tab session")?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await
        .map_err(|_| "Tab session preparation timed out")?
        .map_err(|_| "Tab session preparation was interrupted")?
        .map_err(str::to_owned)
}
