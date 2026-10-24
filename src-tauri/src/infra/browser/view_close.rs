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
    super::super::website_data::session_storage::clear(&webview);
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
    super::super::site_settings::permissions::forget_private_session();
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
