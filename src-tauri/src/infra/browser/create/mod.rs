//! Creating a browser page webview and its favicon and compatibility probes.

use super::super::space_windows;
use super::*;

mod events;
mod setup;
use events::{new_window, page_load};
use setup::{adopt_existing, eval_ephemeral_session, record_request};

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
    // The page's Space, and with it its website data, comes from the window that asks
    // for it, never from the request.
    let owner = caller.window().label().to_owned();
    let space =
        space_windows::space_for_owner(&owner).ok_or("Only a Space window can open pages.")?;
    let incognito = space_windows::incognito_session(&owner)
        .or_else(eval_ephemeral_session)
        .map(|session| space_windows::incognito_store_id(&session));
    request.private = incognito.is_some();
    // On Windows each Space keeps its pages' data in its own folder, incognito included.
    let space_data = space_windows::space_store_identity(&space);
    // The personal Space uses its vault's store; every other Space its own.
    request.profile_id = space_windows::space_store_identity(&space);
    // Incognito pages never restore a synced session or bind an account profile.
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
    record_request(&state, &request, &profile_lease.logical_profile_id)?;
    let shortcut_token = shortcut_token_for(&state, &request.id)?;
    if let Some(webview) = app.get_webview(&label) {
        return adopt_existing(&app, &state, &window, webview, &request, &space, position, size);
    }

    let page_app = app.clone();
    let page_id = request.id.clone();
    let page_space = space.clone();
    let title_app = app.clone();
    let title_id = request.id.clone();
    let popup_app = app.clone();
    let popup_id = request.id.clone();
    let download_app = app.clone();
    let download_id = request.id.clone();
    let replacing_extension_view =
        super::super::extensions::pending_navigation(&space, &request.id).await;
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
        if request.private {
            space_data.as_deref()
        } else {
            request.profile_id.as_deref()
        },
    )?;
    // An incognito view joins its Space's incognito session (see vendor/wry's
    // MISTY-PATCH.md): the identifier names the session, never a persistent store.
    let builder = match incognito {
        Some(session) => builder.incognito(true).data_store_identifier(session),
        None => builder.data_store_identifier(profile_identifier),
    };
    // Incognito windows have no extension host.
    #[cfg(target_os = "macos")]
    let builder = if request.private {
        builder
    } else {
        let pointer = super::super::extensions::native::configuration(
            &app,
            &space,
            profile_identifier,
            request.private,
            request.url.clone(),
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
        // Captions for questions about a video, read in every frame; private tabs keep none.
        .initialization_script_for_all_frames(if request.private || preview_only {
            String::new()
        } else {
            browser_captions_script()
        })
        .initialization_script_for_all_frames(if cfg!(windows) && !preview_only {
            include_str!("../scripts/background_tab.js")
        } else { "" })
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
            new_window(&popup_app, &popup_id, url, features)
        })
        .on_page_load(move |webview, payload| {
            if preview_only { return; }
            page_load(&page_app, &page_space, &page_id, restoring_tab_session, webview, payload);
        })
        .on_document_title_changed(move |webview, title| {
            if preview_only { return; }
            let _ = title_app.emit_to(
                browser_owner_label(&title_app, &title_id).as_str(),
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
        super::super::extensions::native::register(
            &webview,
            &space,
            &request.id,
            request.private,
            &request.url,
        );
    }
    host_messages::install(&webview)?;
    if !preview_only {
        super::super::browser_frames::install(&webview)?;
    }
    #[cfg(target_os = "macos")]
    if !preview_only {
        url_observer::install(&app, &webview, &request.id)?;
    }
    #[cfg(windows)]
    super::super::browser_process_ended::watch_page_process(&webview);
    #[cfg(windows)]
    watch_page_focus(&webview, &request.id);
    #[cfg(windows)]
    super::super::window_focus_windows::watch(&webview);
    #[cfg(windows)]
    engine_menu::install(&webview, false);
    #[cfg(target_os = "macos")]
    attachment_download_macos::install(&webview)?;
    #[cfg(any(target_os = "macos", windows))]
    if let Some(values) = profile_lease
        .tab_session
        .as_ref()
        .filter(|_| !replacing_extension_view)
    {
        let url = external_url(&request.url)?;
        if let Err(error) = super::super::website_data::session_storage::install(
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
