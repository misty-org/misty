use crate::browser::app_windows;
use crate::browser::*;

mod events;
mod setup;
use events::{new_window, page_load};
use setup::{adopt_existing, record_request};

#[tauri::command]
pub async fn browser_webview_create(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewCreateRequest,
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
    let owner = caller.window().label().to_owned();
    let profile =
        app_windows::profile_for_owner(&owner).ok_or("Only a profile's window can open pages.")?;
    let page_store = crate::browser::profiles::page_store(&profile).await?;
    trace_create("lease acquired");
    let store_id = page_store.store.clone();
    let store_identifier = webkit_store_identifier(store_id.as_deref())?;
    external_url(&request.url)?;
    remember_main_macos_webview(&app, caller.window().label())?;
    let label = webview_label(&request.id)?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    let window = caller.window();
    if app.get_webview(&label).is_some() {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        if let Some(session) = sessions.get(&request.id) {
            if store_id.is_some() && session.store_id != store_id {
                return Err(
                    "browser_profile_changed: reopen the target in its intended profile".into(),
                );
            }
        }
    }
    register_session(&state, &request.id, &request.scope_id)?;
    record_request(&state, &request, store_id.clone(), &profile)?;
    let shortcut_token = shortcut_token_for(&state, &request.id)?;
    if let Some(webview) = app.get_webview(&label) {
        return adopt_existing(&app, &state, webview, &request, position, size);
    }

    let page_app = app.clone();
    let page_id = request.id.clone();
    let title_app = app.clone();
    let title_id = request.id.clone();
    let popup_app = app.clone();
    let popup_id = request.id.clone();
    let download_app = app.clone();
    let download_id = request.id.clone();
    let initial_url = external_url(&request.url)?;
    let builder = with_store_data(
        WebviewBuilder::new(label, WebviewUrl::External(initial_url))
            .background_throttling(BackgroundThrottlingPolicy::Disabled),
        &app,
        store_id.as_deref(),
    )?;
    #[cfg(not(windows))]
    let builder = builder.background_color(browser_background());
    #[cfg(windows)]
    let builder = builder.general_autofill_enabled(false);
    let builder = builder.data_store_identifier(store_identifier);
    let builder = if let Some(user_agent) = native_macos_safari_user_agent() {
        builder.user_agent(&user_agent)
    } else {
        builder
    };
    let initial_bindings = crate::browser::input::shortcuts::current_shortcut_bindings(&state);
    let builder = builder
        .focused(false)
        .accept_first_mouse(true)
        .initialization_script(browser_viewport_script(
            &shortcut_token,
            renderer(caller.window().label()).tracking,
            &initial_bindings,
        ))
        .initialization_script(browser_status_script(&shortcut_token))
        .initialization_script(kiri::page_script())
        .on_navigation(move |url| external_url(url.as_str()).is_ok())
        .on_new_window(move |url, features| new_window(&popup_app, &popup_id, url, features))
        .on_page_load(move |webview, payload| {
            page_load(&page_app, &page_id, webview, payload);
        })
        .on_document_title_changed(move |webview, title| {
            let _ = title_app.emit_to(
                browser_owner_label(&title_app, &title_id).as_str(),
                "misty://browser-title",
                BrowserTitleEvent {
                    id: title_id.clone(),
                    title,
                },
            );
            request_browser_favicon(&webview, &title_app, &title_id);
        })
        .on_download(move |_webview, event| {
            handle_download_event(&download_app, &download_id, event)
        });
    #[cfg(windows)]
    let initial_position = {
        hold_until_first_paint(&app, &request.id);
        PARKED_POSITION
    };
    #[cfg(not(windows))]
    let initial_position = position;
    trace_create("creating the native webview");
    let created = {
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
    crate::browser::agent_pages::frames::install(&webview)?;
    #[cfg(target_os = "macos")]
    crate::browser::pages::url_observer::install(&app, &webview, &request.id)?;
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
    apply_macos_webview_theme(&webview)?;
    configure_browser_webview(&webview, request.native_live_resize)?;
    apply_shortcuts(&webview, &state)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    trace_create("created and presented");
    present_macos_webview(&webview)
}
