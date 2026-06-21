#![allow(unexpected_cfgs)]
use super::*;

/// Keep WebKit's original popup configuration (including window.opener and the website
/// data store). Integration popups remain native auxiliary windows; ordinary
/// Browser popups are adopted into Browser tabs.
#[cfg(target_os = "macos")]
pub(super) fn provider_popup(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
) -> Option<NewWindowResponse<tauri::Wry>> {
    let state = app.state::<BrowserSessionState>();
    let (provider, profile, oauth_callback, origin_space_id, attached) = {
        let sessions = state.sessions.lock().ok()?;
        let source = sessions.get(source_id)?;
        let provider = source.profile_provider.clone();
        if external_url(url.as_str()).is_err()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        (
            provider,
            source.profile_id.clone(),
            source.oauth_callback.clone(),
            source.origin_space_id.clone(),
            source.provider_id.is_some() || source.popup_parent.is_some(),
        )
    };
    // For integration windows, failure must never fall back to a fresh Browser tab.
    let result = create_popup(
        app,
        source_id,
        url,
        features,
        provider,
        profile,
        oauth_callback,
        origin_space_id,
        attached,
    );
    if attached {
        Some(result.unwrap_or(NewWindowResponse::Deny))
    } else {
        result
    }
}

#[allow(clippy::too_many_arguments)]
fn create_popup(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
    provider: Option<String>,
    profile: Option<String>,
    oauth_callback: Option<(
        super::super::browser_provider::OAuthCallback,
        std::time::Instant,
    )>,
    origin_space_id: Option<String>,
    attached: bool,
) -> Option<NewWindowResponse<tauri::Wry>> {
    let state = app.state::<BrowserSessionState>();
    // WebKit's target configuration shares the opener's user-content controller.
    // Give this tab its own scripts and IPC handlers without replacing the required
    // configuration or its website data store. Otherwise the opener's shortcut token
    // and native message handler can leak into the popup (and vice versa).
    let main_thread = objc2::MainThreadMarker::new()?;
    unsafe {
        features
            .opener()
            .target_configuration
            .setUserContentController(&objc2_web_kit::WKUserContentController::new(main_thread));
    }
    let parent = if attached {
        let source = app.get_webview(&webview_label(source_id).ok()?)?;
        Some(source.window().ns_window().ok()?)
    } else {
        None
    };
    let key = format!("popup-{}", uuid::Uuid::new_v4());
    let id = format!("tab-{key}");
    let label = webview_label(&id).ok()?;
    register_session(&state, &id, "").ok()?;
    {
        let mut sessions = state.sessions.lock().ok()?;
        let session = sessions.get_mut(&id)?;
        session.profile_id = profile;
        session.profile_provider = provider;
        session.popup_parent = attached.then(|| source_id.to_owned());
        session.provider_id = None;
        session.oauth_callback = oauth_callback;
        session.origin_space_id = origin_space_id;
    }
    let shortcut_token = shortcut_token_for(&state, &id).ok()?;
    let navigation_app = app.clone();
    let navigation_id = id.clone();
    let page_app = app.clone();
    let page_id = id.clone();
    let title_app = app.clone();
    let title_id = id.clone();
    let download_app = app.clone();
    let download_id = id.clone();
    let popup_app = app.clone();
    let popup_id = id.clone();
    let builder = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.clone()))
        .window_features(features)
        .visible(false)
        .focused(false)
        .background_throttling(BackgroundThrottlingPolicy::Throttle)
        .initialization_script(browser_viewport_script(&shortcut_token, false))
        .on_navigation(move |url| {
            #[cfg(target_os = "macos")]
            if context_menu::forward(&navigation_app, &navigation_id, url) {
                return false;
            }
            if let Some(pointer) = browser_pointer_navigation(url) {
                emit_browser_pointer(&navigation_app, &navigation_id, pointer);
                return false;
            }
            if forward_focus_navigation(&navigation_app, &navigation_id, url)
                || forward_companion_navigation(&navigation_app, &navigation_id, url)
                || forward_navigation(&navigation_app, &navigation_id, url)
            {
                return false;
            }
            external_url(url.as_str()).is_ok()
        })
        .on_page_load(move |window, payload| {
            let webview: &Webview = window.as_ref();
            let started = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            if started {
                let state = page_app.state::<BrowserSessionState>();
                if let Ok(mut sessions) = state.sessions.lock() {
                    if let Some(session) = sessions.get_mut(&page_id) {
                        session.element_targets.clear();
                    }
                }
                let _ = apply_shortcuts(webview, &state);
            }
            let _ = apply_browser_pointer_tracking(
                webview,
                BROWSER_POINTER_TRACKING_ENABLED.load(Ordering::Acquire),
            );
            let _ = page_app.emit(
                "misty://browser-page",
                BrowserPageEvent {
                    id: page_id.clone(),
                    url: payload.url().to_string(),
                    phase: if started { "started" } else { "finished" },
                },
            );
            if !started {
                apply_page_zoom_policy(webview, &page_app, &page_id);
                request_browser_favicon(webview, &page_app, &page_id);
                request_browser_compatibility(webview, &page_app, &page_id);
            }
        })
        .on_document_title_changed(move |window, title| {
            let _ = title_app.emit(
                "misty://browser-title",
                BrowserTitleEvent {
                    id: title_id.clone(),
                    title,
                },
            );
            request_browser_favicon(window.as_ref(), &title_app, &title_id);
            request_browser_compatibility(window.as_ref(), &title_app, &title_id);
        })
        .on_download(move |_window, event| {
            handle_download_event(&download_app, &download_id, event)
        })
        .on_new_window(move |url, features| {
            if let Some(response) = provider_popup(&popup_app, &popup_id, &url, features) {
                return response;
            }
            if external_url(url.as_str()).is_ok() {
                let _ = popup_app.emit(
                    "misty://browser-popup",
                    BrowserPopupEvent {
                        source_id: popup_id.clone(),
                        url: url.to_string(),
                        popup_instance_key: None,
                    },
                );
            }
            NewWindowResponse::Deny
        });
    let builder = if let Some(parent) = parent {
        builder
            .parent_raw(parent)
            .title("Sign in · Misty")
            .inner_size(520.0, 700.0)
            .min_inner_size(360.0, 420.0)
            .center()
    } else {
        builder
    };
    let builder = if let Some(agent) = native_macos_safari_user_agent() {
        builder.user_agent(&agent)
    } else {
        builder
    };
    let window = match builder.build() {
        Ok(window) => window,
        Err(_) => {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&id);
            }
            forget_shortcut_token(&state, &id);
            return None;
        }
    };
    if attached {
        let close_app = app.clone();
        let close_id = id.clone();
        let source_id = source_id.to_owned();
        window.on_window_event(move |event| {
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }
            let state = close_app.state::<BrowserSessionState>();
            // Remove descendants as well when the user cancels an outer sign-in window.
            let children = state
                .sessions
                .lock()
                .map(|mut sessions| {
                    sessions.remove(&close_id);
                    sessions
                        .iter()
                        .filter(|(_, session)| session.popup_parent.as_deref() == Some(&close_id))
                        .map(|(id, _)| id.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            forget_shortcut_token(&state, &close_id);
            forget_close_handler(&close_id);
            for id in children {
                let _ = browser_webview_close(
                    close_app.clone(),
                    close_app.state::<BrowserSessionState>(),
                    BrowserWebviewIdRequest { id },
                );
            }
            if let Some(source) = webview_label(&source_id)
                .ok()
                .and_then(|label| close_app.get_webview(&label))
            {
                let _ = source.window().set_focus();
                let _ = source.set_focus();
            }
        });
        if install_close_handler(app, window.as_ref(), &id).is_err() {
            let _ = window.destroy();
            return Some(NewWindowResponse::Deny);
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Some(NewWindowResponse::Create { window });
    }
    state.pending_popups.lock().ok()?.insert(id.clone());
    let _ = app.emit(
        "misty://browser-popup",
        BrowserPopupEvent {
            source_id: source_id.to_owned(),
            url: url.to_string(),
            popup_instance_key: Some(key),
        },
    );
    let cleanup_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
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
    Some(NewWindowResponse::Create { window })
}

// Wry 0.55 supplies popup creation but omits WKUIDelegate.webViewDidClose.
// Handle WebKit's actual close notification, including OAuth completion, without
// injecting a replacement window.close or guessing which URL means success.
use std::sync::OnceLock;
type CloseTarget = (AppHandle, String);
static CLOSE_TARGETS: OnceLock<Mutex<HashMap<usize, CloseTarget>>> = OnceLock::new();
fn close_targets() -> &'static Mutex<HashMap<usize, CloseTarget>> {
    CLOSE_TARGETS.get_or_init(Mutex::default)
}
pub(super) fn forget_close_handler(id: &str) {
    if let Ok(mut targets) = close_targets().lock() {
        targets.retain(|_, (_, target)| target != id);
    }
}
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
        // Leave WebKit's delegate callback before destroying its window/view.
        tauri::async_runtime::spawn(async move {
            let close_app = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = browser_webview_close(
                    close_app.clone(),
                    close_app.state::<BrowserSessionState>(),
                    BrowserWebviewIdRequest { id },
                );
            });
        });
    }
}
fn install_close_handler(app: &AppHandle, webview: &Webview, id: &str) -> Result<(), String> {
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
            let _: () = msg_send![view, setUIDelegate: std::ptr::null_mut::<objc::runtime::Object>()];
            let _: () = msg_send![view, setUIDelegate: delegate];
            if let Ok(mut targets) = close_targets().lock() {
                targets.insert(view as usize, (app, id));
            }
        })
        .map_err(|error| error.to_string())
}
