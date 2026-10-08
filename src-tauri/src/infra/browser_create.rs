//! Creating a browser page webview and its favicon and compatibility probes.

use super::*;

#[tauri::command]
// Keep this command asynchronous. WebView2 child creation needs the Windows
// event loop to remain free while `add_child` finishes initializing the view.
pub async fn browser_webview_create(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    mut request: BrowserWebviewCreateRequest,
) -> Result<(), String> {
    let create_started = std::time::Instant::now();
    let trace_create = |step: &str| {
        if cfg!(debug_assertions) {
            eprintln!(
                "[browser-create] {} +{}ms {step}",
                request.id,
                create_started.elapsed().as_millis()
            );
        }
    };
    trace_create("start");
    // Private tabs never restore a synced session or bind an account profile.
    let profile_lease = if request.private {
        super::super::browser_sync::browser_profile_lease(Some(&app), None, None).await?
    } else {
        super::super::browser_sync::browser_profile_lease(
            Some(&app),
            request.profile_id.as_deref(),
            request
                .workspace_tab_id
                .as_deref()
                .map(|id| (id, request.url.as_str())),
        )
        .await?
    };
    trace_create("lease acquired");
    request.profile_id = if request.private {
        None
    } else {
        profile_lease.profile_id.clone()
    };
    let profile_identifier = browser_profile_identifier(request.profile_id.as_deref())?;
    // Integrations use Browser's navigation rules. Provider metadata identifies
    // the account and automation permissions, not where a person may browse.
    external_url(&request.url)?;
    remember_main_macos_webview(&app, caller.window().label())?;
    let label = webview_label(&request.id)?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    let window = caller.window();
    if !request.preview_only {
        window
            .set_theme(browser_theme(&request.theme)?)
            .map_err(|error| error.to_string())?;
    }
    // A live webview's cookie store cannot be changed by updating its metadata.
    // Account switches must close/reopen through the owning host view.
    if app.get_webview(&label).is_some() {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        if let Some(session) = sessions.get(&request.id) {
            if request.profile_id.is_some() && session.profile_id != request.profile_id {
                return Err(
                    "browser_profile_changed: reopen the target in its intended profile".into(),
                );
            }
        }
    }
    register_session(&state, &request.id, &request.scope_id)?;
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?
        .get_mut(&request.id)
    {
        session.workspace_tab_id = if request.preview_only {
            None
        } else {
            request.workspace_tab_id.clone()
        };
        session.origin_space_id = request.origin_space_id.clone();
        session.provider_id = request.provider_id.clone();
        session.private = request.private;
        if request.profile_id.is_some() {
            session.profile_id = request.profile_id.clone();
            session.logical_profile_id = profile_lease.logical_profile_id.clone();
        }
        if request.profile_provider_id.is_some() || request.provider_id.is_some() {
            session.profile_provider = request
                .profile_provider_id
                .clone()
                .or(request.provider_id.clone());
        }
    }
    let shortcut_token = shortcut_token_for(&state, &request.id)?;
    if let Some(webview) = app.get_webview(&label) {
        #[cfg(any(target_os = "macos", windows))]
        if state
            .pending_popups
            .lock()
            .map_err(|_| "Browser popup state is unavailable.")?
            .remove(&request.id)
        {
            let staging = webview.window();
            webview
                .reparent(&window)
                .map_err(|error| error.to_string())?;
            // The popup's view and opener survive; only its empty staging window closes.
            staging.destroy().map_err(|error| error.to_string())?;
            if let Ok(url) = webview.url() {
                let _ = app.emit(
                    "misty://browser-page",
                    BrowserPageEvent {
                        id: request.id.clone(),
                        url: url.to_string(),
                        phase: "finished",
                    },
                );
            }
        }
        apply_macos_webview_theme(&webview, &request.theme)?;
        configure_browser_webview(&webview, request.native_live_resize)?;
        apply_shortcuts(&webview, &state)?;
        apply_browser_pointer_tracking(&webview, renderer(webview.window().label()).tracking)?;
        set_webview_bounds_if_changed(&app, &webview, position, size)?;
        super::super::extensions::native::register(&webview, &request.id, request.private, &request.url);
        return present_macos_webview(&webview);
    }

    let page_app = app.clone();
    let page_id = request.id.clone();
    let title_app = app.clone();
    let title_id = request.id.clone();
    let popup_app = app.clone();
    let popup_id = request.id.clone();
    let download_app = app.clone();
    let download_id = request.id.clone();
    let replacing_extension_view = super::super::extensions::pending_navigation(&request.id).await;
    let restoring_tab_session = profile_lease.tab_session.is_some() || replacing_extension_view;
    let preview_only = request.preview_only;
    let initial_url = if restoring_tab_session {
        "about:blank".parse().map_err(|_| "Invalid bootstrap URL")?
    } else {
        external_url(&request.url)?
    };
    let builder = with_browser_data(
        WebviewBuilder::new(label, WebviewUrl::External(initial_url))
            .background_throttling(BackgroundThrottlingPolicy::Disabled),
        &app,
        request.profile_id.as_deref(),
    )?;
    // With no named store, an incognito view joins the shared private session.
    let builder = if request.private {
        builder.incognito(true)
    } else {
        builder.data_store_identifier(profile_identifier)
    };
    #[cfg(target_os = "macos")]
    let builder = {
        let pointer = super::super::extensions::native::configuration(
            &app,
            profile_identifier,
            request.private,
            request.url.clone(),
            !request.private && profile_lease.logical_profile_id.is_some(),
        )
        .await?;
        if let Some(pointer) = pointer {
            let configuration = unsafe {
                objc2::rc::Retained::from_raw(pointer as *mut objc2_web_kit::WKWebViewConfiguration)
            }
            .ok_or("Could not create extension-aware browser configuration.")?;
            builder.with_webview_configuration(configuration)
        } else {
            builder
        }
    };
    // Bare WKWebView omits Safari's Version/Safari tokens, which makes sites
    // such as Google serve their legacy compatibility UI. Derive the desktop
    // Safari identity from the installed Safari bundle instead of pinning a
    // release in Misty's source.
    let builder = if let Some(user_agent) = native_macos_safari_user_agent() {
        builder.user_agent(&user_agent)
    } else {
        builder
    };
    let initial_bindings = super::super::browser_shortcuts::current_shortcut_bindings(&state);
    let builder = builder
        .focused(false)
        .initialization_script(if preview_only {
            "HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); }; document.addEventListener('play', event => { if (event.target instanceof HTMLMediaElement) { event.target.muted = true; event.target.pause(); } }, true); if (window.AudioContext) window.AudioContext.prototype.resume = function(){ return Promise.resolve(); };"
        } else { "" })
        .accept_first_mouse(true)
        .background_color(browser_background(&request.theme))
        .initialization_script_for_all_frames(browser_scrollbar_script())
        .initialization_script(browser_viewport_script(
            &shortcut_token,
            renderer(caller.window().label()).tracking,
            &initial_bindings,
        ))
        .initialization_script(browser_status_script(&shortcut_token))
        .initialization_script(kiri::page_script())
        .initialization_script(page_tools::media_tools::session::MEDIA_SESSION_PAGE_SCRIPT)
        .on_navigation(move |url| {
            if restoring_tab_session && url.as_str() == "about:blank" { return true; }
            // Misty's page scripts report over Kiri's host channel, never by
            // navigating, so every non-web scheme is refused here. This
            // callback includes frames, redirects and POST submissions.
            // Never turn these requests into URL-only Browser handoffs.
            external_url(url.as_str()).is_ok()
        })
        .on_new_window(move |url, features| {
            if preview_only { return NewWindowResponse::Deny; }
            #[cfg(any(target_os = "macos", windows))]
            if let Some(response) = provider_popup(&popup_app, &popup_id, &url, features) { return response; }
            if external_url(url.as_str()).is_ok() {
                let _ = popup_app.emit(
                    "misty://browser-popup",
                    BrowserPopupEvent {
                        popup_instance_key: None,
                        source_id: popup_id.clone(),
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |webview, payload| {
            if preview_only { return; }
            super::super::extensions::native::tab_event(&page_app, &page_id, "updated");
            if restoring_tab_session && payload.url().as_str() == "about:blank" { return; }
            #[cfg(any(target_os = "macos", windows))]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) { super::super::browser_session_storage::clear(&webview); }
            let locked = page_app.state::<BrowserSessionState>().sessions.lock().ok().and_then(|sessions|sessions.get(&page_id).map(|session|session.agent_input_locked)).unwrap_or(false);
            let _ = apply_agent_input_lock(&webview,locked);
            #[cfg(not(target_os = "macos"))]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let controlled = page_app.state::<BrowserSessionState>().sessions.lock().ok().and_then(|sessions| sessions.get(&page_id).map(agent_controls_page)).unwrap_or(false);
                if controlled { draw_agent_ring(&webview, true); }
            }
            let _ = apply_browser_pointer_tracking(
                &webview,
                renderer(webview.window().label()).tracking,
            );
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(state) = page_app.try_state::<BrowserSessionState>() {
                    if let Ok(mut sessions) = state.sessions.lock() {
                        if let Some(session) = sessions.get_mut(&page_id) {
                            session.snapshot_generation = session.snapshot_generation.wrapping_add(1);
                            session.element_targets.clear();
                        }
                    }
                    let _ = apply_shortcuts(&webview, &state);
                }
                #[cfg(target_os = "macos")]
                host_messages::forget_page_background(&page_id);
            }
            let phase = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            let _ = webview.eval(browser_status_update_script(&json!({ "loading": phase == "started" })));
            let generation = next_load_generation(&page_id);
            if phase == "started" {
                watch_load(&page_app, &page_id, generation);
            }
            let _ = page_app.emit(
                "misty://browser-page",
                BrowserPageEvent {
                    id: page_id.clone(),
                    url: payload.url().to_string(),
                    phase,
                },
            );
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                release_first_paint(&page_app, &page_id);
                if let Some(state) = page_app.try_state::<BrowserSessionState>() {
                    let _ = apply_shortcuts(&webview, &state);
                }
                apply_page_zoom_policy(&webview, &page_app, &page_id);
                super::super::browser_site_style::apply(&webview);
                super::super::browser_night_light::apply(&webview);
                let _ = webview.eval("window.__MISTY_REPORT_BACKGROUND__?.()");
                request_browser_favicon(&webview, &page_app, &page_id);
                request_browser_compatibility(&webview, &page_app, &page_id);
            }
        })
        .on_document_title_changed(move |webview, title| {
            if preview_only { return; }
            let _ = title_app.emit(
                "misty://browser-title",
                BrowserTitleEvent {
                    id: title_id.clone(),
                    title,
                },
            );
            request_browser_favicon(&webview, &title_app, &title_id);
            request_browser_compatibility(&webview, &title_app, &title_id);
        })
        .on_download(move |_webview, event| {
            if preview_only { return false; }
            handle_download_event(&download_app, &download_id, event)
        });
    // On Windows a page waits offscreen from the moment it exists: the steps
    // below take long enough for its blank surface to show over the app.
    #[cfg(windows)]
    let initial_position = if preview_only {
        position
    } else {
        hold_until_first_paint(&app, &request.id);
        PARKED_POSITION
    };
    #[cfg(not(windows))]
    let initial_position = position;
    trace_create("creating the native webview");
    let webview = match window.add_child(builder, initial_position, size) {
        Ok(webview) => webview,
        Err(error) => {
            release_first_paint(&app, &request.id);
            return Err(error.to_string());
        }
    };
    if !preview_only {
        super::super::extensions::native::register(&webview, &request.id, request.private, &request.url);
    }
    host_messages::install(&webview)?;
    #[cfg(target_os = "macos")]
    if !preview_only {
        url_observer::install(&app, &webview, &request.id)?;
    }
    #[cfg(windows)]
    super::super::browser_process_ended::watch_page_process(&webview);
    #[cfg(windows)]
    watch_page_focus(&webview, &request.id);
    #[cfg(target_os = "macos")]
    attachment_download::install(&webview)?;
    #[cfg(any(target_os = "macos", windows))]
    if let Some(values) = profile_lease
        .tab_session
        .as_ref()
        .filter(|_| !replacing_extension_view)
    {
        let url = external_url(&request.url)?;
        if let Err(error) = super::super::browser_session_storage::install(
            &webview,
            &url.origin().ascii_serialization(),
            values,
        )
        .await
        {
            let _ = webview.close();
            return Err(error);
        }
        webview
            .navigate(url)
            .map_err(|_| "Could not open restored tab")?;
    }
    configure_browser_frame_rate(&webview)?;
    apply_macos_webview_theme(&webview, &request.theme)?;
    configure_browser_webview(&webview, request.native_live_resize)?;
    apply_shortcuts(&webview, &state)?;
    webview.set_zoom(1.0).map_err(|error| error.to_string())?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    trace_create("created and presented");
    present_macos_webview(&webview)
}

pub(super) fn request_browser_favicon(webview: &Webview, app: &AppHandle, id: &str) {
    let favicon_app = app.clone();
    let favicon_id = id.to_owned();
    let _ = webview.eval_with_callback(BROWSER_FAVICON_SCRIPT, move |value| {
        let Ok(Some(candidate)) = serde_json::from_str::<Option<String>>(&value) else {
            return;
        };
        let Some(url) = validated_favicon_url(&candidate) else {
            return;
        };
        let _ = favicon_app.emit(
            "misty://browser-favicon",
            BrowserFaviconEvent {
                id: favicon_id.clone(),
                url,
            },
        );
    });
}

pub(super) fn request_browser_compatibility(webview: &Webview, app: &AppHandle, id: &str) {
    let compatibility_app = app.clone();
    let compatibility_id = id.to_owned();
    let _ = webview.eval_with_callback(BROWSER_COMPATIBILITY_SCRIPT, move |value| {
        let Ok(Some(probe)) = serde_json::from_str::<Option<BrowserCompatibilityProbe>>(&value)
        else {
            return;
        };
        if probe.kind != "cloudflare_challenge" || external_url(&probe.url).is_err() {
            return;
        }
        let _ = compatibility_app.emit(
            "misty://browser-compatibility",
            BrowserCompatibilityEvent {
                id: compatibility_id.clone(),
                kind: probe.kind,
                url: probe.url,
            },
        );
    });
}

pub(super) fn validated_favicon_url(value: &str) -> Option<String> {
    if value.len() > 2_048 {
        return None;
    }
    let url = Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}
