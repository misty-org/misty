//! Parking, hiding and closing browser page webviews.

use super::*;

/// Moves the page's window far outside the app and returns keyboard focus to
/// the renderer, keeping the page live and painted. Reconciling its bounds
/// brings it back, because the position then differs from the wanted one.
#[cfg(windows)]
pub(super) fn park_windows_webview(webview: &Webview) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::{
            Input::KeyboardAndMouse::{GetFocus, SetFocus},
            WindowsAndMessaging::{
                IsChild, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
            },
        },
    };

    let renderer = renderer(webview.window().label()).native;
    webview
        .with_webview(move |platform_webview| {
            let mut child = Default::default();
            if unsafe { platform_webview.controller().ParentWindow(&mut child) }.is_err() {
                return;
            }
            let child = child.0 as HWND;
            unsafe {
                SetWindowPos(
                    child,
                    std::ptr::null_mut(),
                    -32_000,
                    -32_000,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                );
                let focused = GetFocus();
                if renderer != 0
                    && !focused.is_null()
                    && (focused == child || IsChild(child, focused) != 0)
                {
                    SetFocus(renderer as HWND);
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_webviews_hide_all(caller: Webview, app: AppHandle) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-")
            && webview.window().label() == caller.window().label()
        {
            if let Err(error) = webview
                .hide()
                .map_err(|error| error.to_string())
                .and_then(|()| refresh_browser_cursor_ownership(&webview))
            {
                errors.push(error);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewsHideExceptRequest {
    pub keep: Vec<String>,
}

/// Hides every tab page in the caller's window that the interface does not want on screen. A
/// page whose tab lost track of it would otherwise stay up, covering the tab that replaced it.
/// Agent and preview pages are left alone: they are not tab pages.
#[tauri::command]
pub fn browser_webviews_hide_except(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewsHideExceptRequest,
) -> Result<(), String> {
    let keep: HashSet<String> = request
        .keep
        .iter()
        .filter_map(|id| webview_label(id).ok())
        .collect();
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if !label.starts_with("misty-browser-tab-")
            || keep.contains(&label)
            || webview.window().label() != caller.window().label()
        {
            continue;
        }
        #[cfg(windows)]
        let hidden = park_windows_webview(&webview);
        #[cfg(not(windows))]
        let hidden = webview.hide().map_err(|error| error.to_string());
        if let Err(error) = hidden.and_then(|()| refresh_browser_cursor_ownership(&webview)) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Closes every tab page in the caller's window whose tab no longer exists. Pages outlive the
/// renderer on purpose, so a reload can hand each tab its live page back; a page whose tab was
/// closed or lost meanwhile would otherwise stay alive (and audible) until the app quits. Popups
/// still waiting for a tab to adopt them, agent pages and previews are left alone.
/// Async for the same reason as `browser_webview_close`: never close on the UI thread.
#[tauri::command]
pub async fn browser_webviews_close_except(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewsHideExceptRequest,
) -> Result<(), String> {
    let keep: HashSet<String> = request
        .keep
        .iter()
        .filter_map(|id| webview_label(id).ok())
        .collect();
    let pending: HashSet<String> = state
        .pending_popups
        .lock()
        .map_err(|_| "Browser popup state is unavailable.")?
        .iter()
        .cloned()
        .collect();
    let orphans: Vec<String> = app
        .webviews()
        .into_iter()
        .filter(|(label, webview)| {
            label.starts_with("misty-browser-tab-")
                && !keep.contains(label)
                && webview.window().label() == caller.window().label()
        })
        .filter_map(|(label, _)| label.strip_prefix("misty-browser-").map(str::to_owned))
        .filter(|id| !pending.contains(id))
        .collect();
    let mut errors = Vec::new();
    for id in orphans {
        if let Err(error) = close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        ) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
pub fn browser_webviews_park_all(caller: Webview, app: AppHandle) -> Result<(), String> {
    // Inactive pages must be hidden, not merely stacked below the renderer.
    // Closing an overlay restacks browser children above it, which otherwise
    // exposes parked WebView2 pages over Home or Agents. Hiding retains the
    // native page and its session for the next explicit reconciliation.
    browser_webviews_hide_all(caller, app)
}

/// Caller holds the browser lifecycle write lease. Enumerate real native views
/// as well as registered sessions so failed/partial creation is also closed.
pub(crate) fn close_account_views(app: &AppHandle) -> Result<(), String> {
    close_account_views_except(app, None)
}

/// A restored, quiescent staging view must survive closure of the old live
/// profile until its activation receipt is committed. Caller holds write lease.
pub(crate) fn close_account_views_except(
    app: &AppHandle,
    keep_label: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<BrowserSessionState>();
    let mut ids: HashSet<String> = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?
        .keys()
        .cloned()
        .collect();
    ids.extend(
        app.webviews()
            .keys()
            .filter_map(|label| label.strip_prefix("misty-browser-").map(str::to_owned)),
    );
    for id in ids {
        if keep_label == Some(format!("misty-browser-{id}").as_str())
            || (keep_label.is_some() && id.starts_with("storage-"))
        {
            continue;
        }
        close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    Ok(())
}

/// The browser views using `logical`'s store (one Space's pages), plus any
/// native page not registered yet: a partial creation could use any store.
/// Hidden capture and storage helpers are left to their owners.
fn profile_view_ids(app: &AppHandle, logical: &str) -> Result<HashSet<String>, String> {
    let state = app.state::<BrowserSessionState>();
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let mut ids: HashSet<String> = sessions
        .iter()
        .filter(|(_, session)| session.logical_profile_id.as_deref() == Some(logical))
        .map(|(id, _)| id.clone())
        .collect();
    ids.extend(
        app.webviews()
            .keys()
            .filter_map(|label| label.strip_prefix("misty-browser-"))
            .filter(|id| {
                !sessions.contains_key(*id)
                    && !id.starts_with("capture-")
                    && !id.starts_with("storage-")
            })
            .map(str::to_owned),
    );
    Ok(ids)
}

/// Labels of the pages a restore into `logical`'s store would replace.
pub(crate) fn profile_view_labels(app: &AppHandle, logical: &str) -> Result<Vec<String>, String> {
    Ok(profile_view_ids(app, logical)?
        .into_iter()
        .map(|id| format!("misty-browser-{id}"))
        .collect())
}

/// Closes one Space's pages before its store is switched or reloaded; other
/// Spaces' pages stay open. Caller holds that vault's store write lease.
pub(crate) fn close_profile_views_except(
    app: &AppHandle,
    logical: &str,
    keep_label: Option<&str>,
) -> Result<(), String> {
    for id in profile_view_ids(app, logical)? {
        if keep_label == Some(format!("misty-browser-{id}").as_str()) {
            continue;
        }
        close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    Ok(())
}

/// Async so it never runs on the UI thread. While the UI thread builds another
/// webview it holds Tauri's webview-context lock and pumps messages, which can
/// deliver this very request; closing there would take the lock again and
/// freeze the app. A worker thread just waits its turn.
#[tauri::command]
pub async fn browser_webview_close(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    close_browser_webview(app, state, request)
}

pub fn close_browser_webview(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    let space = super::super::extensions::native::page_space(&app, &request.id);
    super::super::extensions::native::tab_event(&app, space.as_deref(), &request.id, "close");
    let children = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        sessions.remove(&request.id);
        let children = sessions
            .iter()
            .filter(|(_, session)| session.popup_parent.as_deref() == Some(&request.id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        children
    };
    for id in children {
        close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    #[cfg(any(target_os = "macos", windows))]
    popups::forget_close_handler(&request.id);
    host_messages::forget(&request.id);
    if let Ok(mut pending) = state.pending_popups.lock() {
        pending.remove(&request.id);
    }
    if let Some(staging) = app.get_window(&webview_label(&request.id)?) {
        let _ = staging.destroy();
    }
    forget_shortcut_token(&state, &request.id);
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|platform_webview| unsafe {
        let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
        if objc2::msg_send![view, respondsToSelector: objc2::sel!(_setPageMuted:)] {
            let _: () = objc2::msg_send![view, _setPageMuted: 1usize];
        }
        if objc2::msg_send![view, respondsToSelector: objc2::sel!(pauseAllMediaPlaybackWithCompletionHandler:)] {
            let _: () = objc2::msg_send![view, pauseAllMediaPlaybackWithCompletionHandler: std::ptr::null::<objc2::runtime::AnyObject>()];
        }
        if objc2::msg_send![view, respondsToSelector: objc2::sel!(stopLoading)] {
            let _: () = objc2::msg_send![view, stopLoading];
        }
    });
    let _ = webview.eval(
        "try { window.stop(); document.querySelectorAll('audio, video').forEach(el => { el.pause(); el.muted = true; el.src = ''; el.load(); }); } catch (_) {}"
    );
    if let Ok(blank) = tauri::Url::parse("about:blank") {
        let _ = webview.navigate(blank);
    }
    #[cfg(any(target_os = "macos", windows))]
    super::super::browser_session_storage::clear(&webview);
    unregister_browser_cursor_ownership(&webview)?;
    #[cfg(target_os = "macos")]
    url_observer::remove(&webview, &request.id);
    webview.close().map_err(|error| error.to_string())?;
    Ok(())
}

/// The last incognito window of a Space closed: its session goes, so the next
/// incognito window starts signed out with no site data or permission choices.
pub(crate) fn end_incognito_session(app: &AppHandle, session: &str) {
    let id = super::super::space_windows::incognito_store_id(session);
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || wry::end_private_session(id));
    let _ = (app, id);
    super::super::browser_site_permissions::forget_private_session();
}

/// A window closed with its pages: forget the pages its renderer can no longer close.
pub(crate) fn forget_closed_pages(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrowserSessionState>() {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.retain(|id, _| app.get_webview(&format!("misty-browser-{id}")).is_some());
        }
    }
}
