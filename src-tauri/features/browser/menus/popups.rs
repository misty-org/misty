#![allow(unexpected_cfgs)]
use crate::browser::*;

mod close;
pub(in crate::browser) use close::forget_close_handler;
use close::{close_after_download_wait, install_close_handler};

/// Answers a page's request for a new window. No person adopts a window here, so the page opens in
/// its opener's own view, where the agent's next look finds it. The one exception is the first
/// popup of a download an agent asked for: it opens hidden, keeps its opener and the website data
/// store, and hands its file to the agent's task.
pub(in crate::browser) fn open_popup_in_place(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    #[cfg(debug_assertions)]
    eprintln!("[popup] {source_id} asked to open {url}");
    if external_url(url.as_str()).is_err() || !url.username().is_empty() || url.password().is_some()
    {
        return NewWindowResponse::Deny;
    }
    if let Some(response) = download_popup(app, source_id, url, features) {
        return response;
    }
    // A blank popup the page would write into has nowhere to go; the page itself stays.
    if !matches!(url.scheme(), "https" | "http") {
        return NewWindowResponse::Deny;
    }
    if let Some(view) = webview_label(source_id)
        .ok()
        .and_then(|label| app.get_webview(&label))
    {
        let url = url.clone();
        // Leave the engine's callback before navigating its view.
        tauri::async_runtime::spawn(async move {
            let _ = view.navigate(url);
        });
    }
    NewWindowResponse::Deny
}

/// The hidden popup of an agent's expected download, or `None` when the page has no download
/// waiting on one.
fn download_popup(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
) -> Option<NewWindowResponse<tauri::Wry>> {
    // Creating a webview pumps messages while it waits for WebView2. A popup requested in
    // that pump cannot be built there (it would wait on a lock its own thread holds), so
    // it opens in place instead.
    #[cfg(windows)]
    if crate::browser::pages::creation_guard::in_flight() {
        return None;
    }
    let state = app.state::<BrowserSessionState>();
    let (store, profile, origin_space_id) = {
        let sessions = state.sessions.lock().ok()?;
        let source = sessions.get(source_id)?;
        source
            .pending_agent_download
            .as_ref()
            .filter(|pending| pending.expires_at > Utc::now() && pending.popup_id.is_none())?;
        (
            source.store_id.clone(),
            source.profile.clone(),
            source.origin_space_id.clone(),
        )
    };
    let _lifecycle = crate::browser::profiles::popup_lifecycle_lease()?;
    // Do not fall back to a fresh view: it would discard the opener and profile.
    Some(
        create_popup(
            app,
            source_id,
            url,
            features,
            store,
            profile,
            origin_space_id,
        )
        .unwrap_or(NewWindowResponse::Deny),
    )
}

#[allow(clippy::too_many_arguments)]
fn create_popup(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
    store: Option<String>,
    profile: Option<String>,
    origin_space_id: Option<String>,
) -> Option<NewWindowResponse<tauri::Wry>> {
    let state = app.state::<BrowserSessionState>();
    // WebKit's target configuration shares the opener's user-content controller.
    // Give this tab its own scripts and IPC handlers without replacing the required
    // configuration or its website data store. Otherwise the opener's shortcut token
    // and native message handler can leak into the popup (and vice versa).
    // WebView2 gives every popup its own view and scripts already.
    #[cfg(target_os = "macos")]
    {
        let main_thread = objc2::MainThreadMarker::new()?;
        unsafe {
            features
                .opener()
                .target_configuration
                .setUserContentController(&objc2_web_kit::WKUserContentController::new(
                    main_thread,
                ));
        }
    }
    let id = format!("tab-popup-{}", uuid::Uuid::new_v4());
    let label = webview_label(&id).ok()?;
    register_session(&state, &id, "").ok()?;
    // Only the first popup from an outstanding, explicitly requested task
    // download can return a receipt to that task. It receives no browser grants.
    {
        let mut sessions = state.sessions.lock().ok()?;
        let pending = sessions
            .get_mut(source_id)?
            .pending_agent_download
            .as_mut()
            .filter(|pending| pending.expires_at > Utc::now() && pending.popup_id.is_none())?;
        pending.popup_id = Some(id.clone());
    }
    {
        let mut sessions = state.sessions.lock().ok()?;
        let session = sessions.get_mut(&id)?;
        session.store_id = store;
        session.profile = profile;
        session.popup_parent = Some(source_id.to_owned());
        session.origin_space_id = origin_space_id;
    }
    let shortcut_token = shortcut_token_for(&state, &id).ok()?;
    let download_app = app.clone();
    let download_id = id.clone();
    let download_source = source_id.to_owned();
    let download_started = std::sync::atomic::AtomicBool::new(false);
    let popup_app = app.clone();
    let popup_id = id.clone();
    let popup_state = app.state::<BrowserSessionState>();
    let popup_bindings = crate::browser::input::shortcuts::current_shortcut_bindings(&popup_state);
    let builder = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.clone()))
        .window_features(features)
        .visible(false)
        .focused(false)
        .background_throttling(BackgroundThrottlingPolicy::Throttle)
        .initialization_script(browser_viewport_script(
            &shortcut_token,
            false,
            &popup_bindings,
        ))
        .initialization_script(browser_status_script(&shortcut_token))
        // Misty's page scripts report over Kiri's host channel, never by navigating.
        .on_navigation(move |url| external_url(url.as_str()).is_ok())
        .on_download(move |_window, event| {
            if matches!(&event, DownloadEvent::Requested { .. }) {
                let state = download_app.state::<BrowserSessionState>();
                let authority = state.sessions.lock().ok().and_then(|sessions| {
                    let source = sessions.get(&download_source)?;
                    popup_download_authority(source, &download_id)
                });
                let Some((scope, agent, task)) = authority else {
                    return false;
                };
                if crate::agents::task_scopes::authorize_scope(&download_app, &scope, &agent, &task)
                    .is_err()
                    || download_started.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    return false;
                }
            } else if !download_started.load(std::sync::atomic::Ordering::SeqCst) {
                return false;
            }
            // The source owns both the expected-download wait and verified
            // file receipt. Never grant control of the auxiliary page.
            handle_download_event(&download_app, &download_source, event)
        })
        .on_new_window(move |url, features| {
            open_popup_in_place(&popup_app, &popup_id, &url, features)
        });
    let builder = if let Some(agent) = native_macos_safari_user_agent() {
        builder.user_agent(&agent)
    } else {
        builder
    };
    let built = {
        let _creating = crate::browser::pages::creation_guard::Creating::enter();
        builder.build()
    };
    let window = match built {
        Ok(window) => window,
        Err(_) => {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&id);
            }
            forget_shortcut_token(&state, &id);
            return None;
        }
    };
    #[cfg(target_os = "macos")]
    let attachment_downloads =
        crate::browser::history_downloads::downloads::macos::install(window.as_ref());
    #[cfg(not(target_os = "macos"))]
    let attachment_downloads: Result<(), String> = Ok(());
    if kiri::engine::deny_permission_requests(window.as_ref()).is_err()
        || attachment_downloads.is_err()
        || crate::browser::kiri_link::host_messages::install(window.as_ref()).is_err()
        || install_close_handler(app, window.as_ref(), &id).is_err()
    {
        let _ = window.destroy();
        return Some(NewWindowResponse::Deny);
    }
    close_after_download_wait(app, id);
    Some(NewWindowResponse::Create { window })
}
