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

    wake(webview);
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

/// The pages of the caller's window whose label starts with `prefix`, except the ids in `keep`.
fn window_pages(caller: &Webview, app: &AppHandle, prefix: &str, keep: &[String]) -> Vec<Webview> {
    let keep: HashSet<String> = keep
        .iter()
        .filter_map(|id| webview_label(id).ok())
        .collect();
    app.webviews()
        .into_iter()
        .filter(|(label, webview)| {
            label.starts_with(prefix)
                && !keep.contains(label)
                && webview.window().label() == caller.window().label()
        })
        .map(|(_, webview)| webview)
        .collect()
}

/// Runs `step` on every page, collecting each failure.
fn each_page(
    pages: Vec<Webview>,
    step: impl Fn(&Webview) -> Result<(), String>,
) -> Result<(), String> {
    let errors: Vec<String> = pages.iter().filter_map(|page| step(page).err()).collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn hide_page(webview: &Webview) -> Result<(), String> {
    webview
        .hide()
        .map_err(|error| error.to_string())
        .and_then(|()| refresh_browser_cursor_ownership(webview))
}

#[tauri::command]
pub fn browser_webviews_hide_all(caller: Webview, app: AppHandle) -> Result<(), String> {
    each_page(
        window_pages(&caller, &app, "misty-browser-", &[]),
        hide_page,
    )
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
    #[cfg(windows)]
    let hide = |webview: &Webview| {
        park_windows_webview(webview).and_then(|()| refresh_browser_cursor_ownership(webview))
    };
    #[cfg(not(windows))]
    let hide = hide_page;
    each_page(
        window_pages(&caller, &app, "misty-browser-tab-", &request.keep),
        hide,
    )
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
    let pending: HashSet<String> = state
        .pending_popups
        .lock()
        .map_err(|_| "Browser popup state is unavailable.")?
        .iter()
        .cloned()
        .collect();
    let orphans: Vec<String> = window_pages(&caller, &app, "misty-browser-tab-", &request.keep)
        .iter()
        .filter_map(|webview| {
            webview
                .label()
                .strip_prefix("misty-browser-")
                .map(str::to_owned)
        })
        .filter(|id| !pending.contains(id))
        .collect();
    let errors: Vec<String> = orphans
        .into_iter()
        .filter_map(|id| {
            close_browser_webview(
                app.clone(),
                app.state::<BrowserSessionState>(),
                BrowserWebviewIdRequest { id },
            )
            .err()
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Parks every page in the caller's window except the ones the interface still shows outside a
/// browser tab (`keep`: an agent's page beside its chat), which stay where they are.
#[tauri::command]
pub fn browser_webviews_park_all(
    caller: Webview,
    app: AppHandle,
    request: Option<BrowserWebviewsHideExceptRequest>,
) -> Result<(), String> {
    let keep = request.map(|request| request.keep).unwrap_or_default();
    // On Windows pages stay in place beneath the renderer (`stacked_pages`):
    // overlays leave stacked pages where they are, and the renderer is opaque
    // while no page is presented, so they never show over Home or Agents, and
    // coming back only raises them, already drawn.
    #[cfg(windows)]
    let park = |webview: &Webview| stack_windows_webview(&app, webview);
    // Inactive pages must be hidden, not merely stacked below the renderer.
    // Closing an overlay restacks browser children above it, which otherwise
    // exposes parked pages over Home or Agents. Hiding retains the native page
    // and its session for the next explicit reconciliation.
    #[cfg(not(windows))]
    let park = hide_page;
    each_page(window_pages(&caller, &app, "misty-browser-", &keep), park)
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
    #[cfg(windows)]
    let _ = unstack(&request.id);
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
    // Out of sight before it is blanked: stopping the page and loading about:blank repaint it
    // as an empty white page, which shows if it is still anywhere on screen, such as stacked
    // just beneath the renderer behind a transparent area.
    let _ = webview.hide();
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
    // Close the page itself last, which lets go of its WebKit page process. Removing the view
    // alone left every closed tab's process running (40 to 470 MB each), since something still
    // held the view; the app reached 250 page processes for 54 open pages.
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|platform_webview| unsafe {
        let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
        if objc2::msg_send![view, respondsToSelector: objc2::sel!(_close)] {
            let _: () = objc2::msg_send![view, _close];
        }
    });
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

/// Puts an agent's tab to sleep (docs/design/agent-browser/BRIEF.md, "Memory"): reads where its
/// page is, then closes the page through the one close path, so its page process goes too. The
/// tab wakes later from what this returns.
#[tauri::command]
pub async fn browser_webview_sleep(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(json!({ "closed": false }));
    };
    let url = webview.url().map(|url| url.to_string()).unwrap_or_default();
    let title = page_title(&webview).await;
    close_browser_webview(app.clone(), state, request)?;
    Ok(json!({ "closed": true, "url": url, "title": title }))
}

/// Waits for a new agent tab's first page to load before the agent reads it
/// (browser_page/mod.rs, `first_load`). True once it loaded; false after the wait ran out.
#[tauri::command]
pub async fn browser_webview_await_load(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<bool, String> {
    Ok(super::page_agent::first_load(&app, &request.id).await)
}

/// A small picture of an agent's page (docs/design/agent-browser/BRIEF.md): the PiP and the view
/// switcher show it instead of a second live page.
#[tauri::command]
pub async fn browser_webview_picture(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser page is unavailable.".to_owned())?;
    #[cfg(target_os = "macos")]
    {
        let scale = webview
            .window()
            .scale_factor()
            .map_err(|error| error.to_string())?;
        let size = webview
            .size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);
        super::super::browser_macos::capture_webview_region_sized(
            webview,
            0.0,
            0.0,
            size.width,
            size.height,
            480.0,
        )
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Err("Pictures of pages are not available here yet.".into())
    }
}

#[cfg(target_os = "macos")]
async fn page_title(webview: &Webview) -> String {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let _ = webview.with_webview(move |platform_webview| unsafe {
        let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
        let title: *mut objc2::runtime::AnyObject = objc2::msg_send![view, title];
        let text = if title.is_null() {
            String::new()
        } else {
            let raw: *const std::ffi::c_char = objc2::msg_send![title, UTF8String];
            if raw.is_null() {
                String::new()
            } else {
                std::ffi::CStr::from_ptr(raw).to_string_lossy().into_owned()
            }
        };
        let _ = sender.send(text);
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), receiver)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
async fn page_title(_webview: &Webview) -> String {
    String::new()
}

/// A window closed with its pages: forget the pages its renderer can no longer close.
pub(crate) fn forget_closed_pages(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrowserSessionState>() {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.retain(|id, _| {
                super::webview_label(id).is_ok_and(|label| app.get_webview(&label).is_some())
            });
        }
    }
}
