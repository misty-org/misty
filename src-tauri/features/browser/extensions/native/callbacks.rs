//! Callbacks the macOS extension host makes into Misty: the compat channel and its events.
use super::*;
use std::ffi::c_void;

pub(super) fn install_compat_channel(controller: *mut c_void) {
    // SAFETY: the extension host passes a live user content controller on the main thread.
    unsafe { kiri::extensions::bridge::install(controller) }
}

/// The native extension host answers what Kiri's transport admits.
pub(super) struct CompatHost;

impl kiri::extensions::bridge::ExtensionChannel for CompatHost {
    unsafe fn receive(&self, message: *mut c_void, reply: *mut c_void) {
        // SAFETY: Kiri's contract for `receive` is the host's contract for `compat_message`.
        unsafe { macos::compat_message(message, reply) }
    }
}

/// Whether a page or extension may go to an extension page. The native host asks before it
/// swaps a tab into an extension's view, which WebKit's own check never sees.
pub(super) fn navigation_policy(tab: &str, url: &str, source: &str) -> bool {
    let Ok(target) = url::Url::parse(url) else {
        return false;
    };
    let source = url::Url::parse(source).ok();
    super::super::web_access::navigation_allowed(
        Some(tab).filter(|tab| !tab.is_empty()),
        &target,
        source.as_ref(),
    )
}

/// Lets the extension host take over a page's navigation (true cancels it in WebKit).
pub(super) fn navigation_interceptor(view: *mut c_void, action: *mut c_void) -> bool {
    // SAFETY: wry passes the live WKWebView and WKNavigationAction of the decision it is making.
    let (view, action) = unsafe {
        (
            &*view.cast::<objc2_web_kit::WKWebView>(),
            &*action.cast::<objc2_web_kit::WKNavigationAction>(),
        )
    };
    macos::navigation(view, action)
}

pub(super) fn event(value: Value) {
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
    super::super::approvals::observe_request(&value);
    // Every event names the profile whose host raised it, and goes to that profile only.
    let Some(profile) = value["space"]
        .as_str()
        .filter(|key| crate::browser::app_windows::valid_key(key))
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
            crate::browser::app_windows::emit_to_profile(
                &app,
                &profile,
                "misty://extensions",
                value,
            );
        });
    } else {
        if value["kind"] == "runtime-error" {
            let event = value.clone();
            let profile = profile.clone();
            tauri::async_runtime::spawn(async move {
                let mut state = super::super::service(&profile).lock().await;
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
        crate::browser::app_windows::emit_to_profile(app, &profile, "misty://extensions", value);
    }
}
