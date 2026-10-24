//! Callbacks the macOS extension host makes into Misty: the compat channel and its events.
use super::*;

#[cfg(target_os = "macos")]
pub(super) extern "C" fn install_compat_channel(controller: *mut c_void) {
    unsafe { kiri::extensions::bridge::install(controller) }
}

/// The native extension host answers what Kiri's transport admits.
#[cfg(target_os = "macos")]
pub(super) struct CompatHost;

#[cfg(target_os = "macos")]
impl kiri::extensions::bridge::ExtensionChannel for CompatHost {
    unsafe fn receive(&self, message: *mut c_void, reply: *mut c_void) {
        misty_extensions_compat_message(message, reply);
    }
}

#[cfg(target_os = "macos")]
pub(super) extern "C" fn event(pointer: *const c_char) {
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
        return;
    }
    // Every event names the Space whose host raised it, and goes to that Space only.
    let Some(space) = value["space"]
        .as_str()
        .filter(|key| crate::infra::space_windows::valid_key(key))
        .map(str::to_owned)
    else {
        return;
    };
    if value["kind"] == "replace-view" {
        let app = app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(id) = value["tabId"].as_str() {
                if let Some(view) = app.get_webview(&format!("misty-browser-{id}")) {
                    let _ = view.close();
                }
            }
            crate::infra::space_windows::emit_to_space(&app, &space, "misty://extensions", value);
        });
    } else {
        if value["kind"] == "runtime-error" {
            let event = value.clone();
            let space = space.clone();
            tauri::async_runtime::spawn(async move {
                let mut state = super::super::service(&space).lock().await;
                if event["account"].as_str() == Some(&state.account) {
                    if let Some(status) =
                        event["id"].as_str().and_then(|id| state.states.get_mut(id))
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
        crate::infra::space_windows::emit_to_space(app, &space, "misty://extensions", value);
    }
}
