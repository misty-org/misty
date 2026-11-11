//! Creating a browser page webview and its favicon and compatibility probes.

use crate::browser::app_windows;
use crate::browser::*;

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
    // The page's profile, and with it its website data, comes from the window that asks
    // for it, never from the request.
    let owner = caller.window().label().to_owned();
    let profile =
        app_windows::profile_for_owner(&owner).ok_or("Only a profile's window can open pages.")?;
    // No window is private. Only the eval bridge's test pages open in a temporary session.
    let temporary =
        eval_ephemeral_session().map(|session| app_windows::temporary_store_id(&session));
    request.private = temporary.is_some();
    #[cfg(any(target_os = "macos", windows))]
    if !request.private {
        crate::sync::vault::site_data::prepare_page(&profile, &request.url).await;
    }
    // Holds the account steady until the view has finished opening.
    let page_store = crate::browser::profiles::page_store(&profile).await?;
    trace_create("lease acquired");
    // On Windows each store keeps its pages' data in its own folder, temporary pages included.
    let window_store = page_store.store.clone();
    // Temporary pages never bind a persistent store.
    request.store_id = if request.private {
        None
    } else {
        page_store.store.clone()
    };
    let store_identifier = data_store_identifier(request.store_id.as_deref())?;
    // Integrations use Browser's navigation rules. Provider metadata identifies
    // the account and automation permissions, not where a person may browse.
    external_url(&request.url)?;
    remember_main_macos_webview(&app, caller.window().label())?;
    let label = webview_label(&request.id)?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    let window = caller.window();
    if !request.preview_only {
        // A `None` theme reset can repaint WebView2's native scrollbar. Match
        // the update path and apply a theme only when one is explicit.
        if let Some(theme) = browser_theme(&request.theme)? {
            window
                .set_theme(Some(theme))
                .map_err(|error| error.to_string())?;
        }
    }
    // A live webview's cookie store cannot be changed by updating its metadata.
    // Account switches must close/reopen through the owning host view.
    if app.get_webview(&label).is_some() {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        if let Some(session) = sessions.get(&request.id) {
            if request.store_id.is_some() && session.store_id != request.store_id {
                return Err(
                    "browser_profile_changed: reopen the target in its intended profile".into(),
                );
            }
        }
    }
    register_session(&state, &request.id, &request.scope_id)?;
    record_request(&state, &request, &profile)?;
    let shortcut_token = shortcut_token_for(&state, &request.id)?;
    if let Some(webview) = app.get_webview(&label) {
        return adopt_existing(&app, &state, &window, webview, &request, position, size);
    }

    let page_app = app.clone();
    let page_id = request.id.clone();
    let title_app = app.clone();
    let title_id = request.id.clone();
    let popup_app = app.clone();
    let popup_id = request.id.clone();
    let download_app = app.clone();
    let download_id = request.id.clone();
    let preview_only = request.preview_only;
    let initial_url = external_url(&request.url)?;
    let builder = with_store_data(
        WebviewBuilder::new(label, WebviewUrl::External(initial_url))
            .background_throttling(BackgroundThrottlingPolicy::Disabled),
        &app,
        if request.private {
            window_store.as_deref()
        } else {
            request.store_id.as_deref()
        },
    )?;
    // WebView2 already supplies the browser's default canvas. A Misty-themed
    // background leaks through transparent website surfaces and can repaint
    // the native scrollbar during creation.
    #[cfg(not(windows))]
    let builder = builder.background_color(browser_background());
    // WebView2's own autofill opens a native dropdown under the field, on top of everything the
    // page draws, so it would cover Misty's saved sign-ins (`PasswordFillMenu`).
    #[cfg(windows)]
    let builder = builder.general_autofill_enabled(false);
    // A temporary view joins the temporary session (see vendor/wry's MISTY-PATCH.md): the
    // identifier names the session, never a persistent store.
    let builder = match temporary {
        Some(session) => builder.incognito(true).data_store_identifier(session),
        None => builder.data_store_identifier(store_identifier),
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
    let initial_bindings = crate::browser::input::shortcuts::current_shortcut_bindings(&state);
    let builder = builder
        .focused(false)
        .initialization_script(if preview_only {
            "HTMLMediaElement.prototype.play = function(){ return Promise.resolve(); }; document.addEventListener('play', event => { if (event.target instanceof HTMLMediaElement) { event.target.muted = true; event.target.pause(); } }, true); if (window.AudioContext) window.AudioContext.prototype.resume = function(){ return Promise.resolve(); };"
        } else { "" })
        .accept_first_mouse(true)
        // Captions for questions about a video, read in every frame; private tabs keep none.
        .initialization_script_for_all_frames(if request.private || preview_only {
            String::new()
        } else {
            browser_captions_script()
        })
        .initialization_script_for_all_frames(if cfg!(windows) && !preview_only {
            include_str!("../../kiri_link/scripts/background_tab.js")
        } else { "" })
        .initialization_script_for_all_frames(if preview_only {
            ""
        } else {
            crate::browser::agent_pages::page_tools::MEDIA_HOLD_SCRIPT
        })
        .initialization_script_for_all_frames(if request.hold_media && !preview_only {
            crate::browser::agent_pages::page_tools::media_hold_state(true)
        } else {
            String::new()
        })
        .initialization_script(browser_viewport_script(
            &shortcut_token,
            renderer(caller.window().label()).tracking,
            &initial_bindings,
        ))
        .initialization_script(browser_status_script(&shortcut_token))
        .initialization_script(kiri::page_script())
        .initialization_script(crate::browser::agent_pages::page_tools::media_tools::session::MEDIA_SESSION_PAGE_SCRIPT)
        .on_navigation(move |url| {
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
            page_load(&page_app, &page_id, webview, payload);
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
    let created = {
        // A popup requested while this view is created is opened as a tab (see creation_guard).
        let _creating = super::creation_guard::Creating::enter();
        window.add_child(builder, initial_position, size)
    };
    let webview = match created {
        Ok(webview) => webview,
        Err(error) => {
            release_first_paint(&app, &request.id);
            return Err(error.to_string());
        }
    };
    crate::browser::kiri_link::host_messages::install(&webview)?;
    if !preview_only {
        crate::browser::agent_pages::frames::install(&webview)?;
    }
    #[cfg(target_os = "macos")]
    if !preview_only {
        crate::browser::pages::url_observer::install(&app, &webview, &request.id)?;
    }
    #[cfg(windows)]
    crate::browser::pages::process_ended::watch_page_process(&webview);
    #[cfg(windows)]
    watch_page_focus(&webview, &request.id);
    #[cfg(windows)]
    crate::browser::app_windows::windows::focus::watch(&webview);
    #[cfg(windows)]
    crate::browser::menus::engine_menu::install(&webview, false);
    #[cfg(target_os = "macos")]
    crate::browser::history_downloads::downloads::macos::install(&webview)?;
    configure_browser_frame_rate(&webview)?;
    apply_macos_webview_theme(&webview, &request.theme)?;
    configure_browser_webview(&webview, request.native_live_resize)?;
    apply_shortcuts(&webview, &state)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    trace_create("created and presented");
    present_macos_webview(&webview)
}
