#![allow(unexpected_cfgs)]
use super::*;

mod close;
pub(super) use close::forget_close_handler;
use close::{expire_unadopted, install_close_handler};

/// Keep the engine's original popup (including window.opener and the website
/// data store). All popups, including authentication, are adopted into Browser tabs.
pub(super) fn provider_popup(
    app: &AppHandle,
    source_id: &str,
    url: &Url,
    features: tauri::webview::NewWindowFeatures,
) -> Option<NewWindowResponse<tauri::Wry>> {
    let _lifecycle = super::super::browser_sync::popup_lifecycle_lease()?;
    let state = app.state::<BrowserSessionState>();
    let (provider, profile, logical_profile, oauth_callback, origin_space_id, private) = {
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
            source.logical_profile_id.clone(),
            source.oauth_callback.clone(),
            source.origin_space_id.clone(),
            source.private,
        )
    };
    // Do not fall back to a fresh view: it would discard the opener and profile.
    Some(
        create_popup(
            app,
            source_id,
            url,
            features,
            provider,
            profile,
            logical_profile,
            oauth_callback,
            origin_space_id,
            private,
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
    provider: Option<String>,
    profile: Option<String>,
    logical_profile: Option<String>,
    oauth_callback: Option<(
        super::super::browser_provider::OAuthCallback,
        std::time::Instant,
    )>,
    origin_space_id: Option<String>,
    // An incognito tab's popup shares its session (WebKit hands it the opener's
    // configuration) and keeps nothing either.
    private: bool,
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
    let key = format!("popup-{}", uuid::Uuid::new_v4());
    let id = format!("tab-{key}");
    let label = webview_label(&id).ok()?;
    register_session(&state, &id, "").ok()?;
    // Only the first popup from an outstanding, explicitly requested task
    // download can return a receipt to that task. It receives no browser grants.
    let agent_download_source = {
        let mut sessions = state.sessions.lock().ok()?;
        let source = sessions.get_mut(source_id)?;
        let pending = source.pending_agent_download.as_mut();
        pending
            .filter(|pending| pending.expires_at > Utc::now() && pending.popup_id.is_none())
            .map(|pending| {
                pending.popup_id = Some(id.clone());
                source_id.to_owned()
            })
    };
    {
        let mut sessions = state.sessions.lock().ok()?;
        let session = sessions.get_mut(&id)?;
        session.profile_id = profile;
        session.logical_profile_id = logical_profile;
        session.profile_provider = provider;
        session.popup_parent = agent_download_source.clone();
        session.provider_id = None;
        session.oauth_callback = oauth_callback;
        session.origin_space_id = origin_space_id;
        session.private = private;
    }
    let shortcut_token = shortcut_token_for(&state, &id).ok()?;
    let page_app = app.clone();
    let page_id = id.clone();
    let title_app = app.clone();
    let title_id = id.clone();
    // Until a tab adopts it, the popup sits in a staging window; its events go to
    // the window of the tab that opened it.
    let page_owner = source_id.to_owned();
    let title_owner = source_id.to_owned();
    let download_app = app.clone();
    let download_id = id.clone();
    let download_source = agent_download_source.clone();
    let download_started = std::sync::atomic::AtomicBool::new(false);
    let popup_app = app.clone();
    let popup_id = id.clone();
    let popup_state = app.state::<BrowserSessionState>();
    let popup_bindings = crate::infra::browser_shortcuts::current_shortcut_bindings(&popup_state);
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
        .on_page_load(move |window, payload| {
            let webview: &Webview = window.as_ref();
            let started = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            if let Some(state) = page_app.try_state::<BrowserSessionState>() {
                if started {
                    if let Ok(mut sessions) = state.sessions.lock() {
                        if let Some(session) = sessions.get_mut(&page_id) {
                            session.element_targets.clear();
                        }
                    }
                }
                let _ = apply_shortcuts(webview, &state);
            }
            let _ = apply_browser_pointer_tracking(
                webview,
                renderer(webview.window().label()).tracking,
            );
            let _ = webview.eval(browser_status_update_script(&json!({ "loading": started })));
            let _ = page_app.emit_to(
                browser_owner_label(&page_app, &page_owner).as_str(),
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
            let _ = window.set_title(&format!("{title} · Misty"));
            let _ = title_app.emit_to(
                browser_owner_label(&title_app, &title_owner).as_str(),
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
            if let Some(source_id) = download_source.as_deref() {
                if matches!(&event, DownloadEvent::Requested { .. }) {
                    let state = download_app.state::<BrowserSessionState>();
                    let authority = state.sessions.lock().ok().and_then(|sessions| {
                        let source = sessions.get(source_id)?;
                        popup_download_authority(source, &download_id)
                    });
                    let Some((scope, agent, task)) = authority else {
                        return false;
                    };
                    if super::super::agents::workspace::authorize_scope(
                        &download_app,
                        &scope,
                        &agent,
                        &task,
                    )
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
                return handle_download_event(&download_app, source_id, event);
            }
            handle_download_event(&download_app, &download_id, event)
        })
        .on_new_window(move |url, features| {
            if let Some(response) = provider_popup(&popup_app, &popup_id, &url, features) {
                return response;
            }
            if external_url(url.as_str()).is_ok() {
                let _ = popup_app.emit_to(
                    browser_owner_label(&popup_app, &popup_id).as_str(),
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
    #[cfg(target_os = "macos")]
    let attachment_downloads = attachment_download_macos::install(window.as_ref());
    #[cfg(not(target_os = "macos"))]
    let attachment_downloads: Result<(), String> = Ok(());
    if super::super::site_settings::permissions::install(window.as_ref()).is_err()
        || attachment_downloads.is_err()
        || host_messages::install(window.as_ref()).is_err()
        || install_close_handler(app, window.as_ref(), &id).is_err()
    {
        let _ = window.destroy();
        return Some(NewWindowResponse::Deny);
    }
    state.pending_popups.lock().ok()?.insert(id.clone());
    if agent_download_source.is_none() {
        let _ = app.emit_to(
            browser_owner_label(&app, source_id).as_str(),
            "misty://browser-popup",
            BrowserPopupEvent {
                source_id: source_id.to_owned(),
                url: url.to_string(),
                popup_instance_key: Some(key),
            },
        );
    }
    expire_unadopted(app, id, label, agent_download_source.is_some());
    Some(NewWindowResponse::Create { window })
}
