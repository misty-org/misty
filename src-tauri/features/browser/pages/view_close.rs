use crate::browser::*;

#[cfg(windows)]
pub(in crate::browser) fn park_windows_webview(webview: &Webview) -> Result<(), String> {
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
    unstack(&request.id);
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
    crate::browser::menus::popups::forget_close_handler(&request.id);
    crate::browser::kiri_link::host_messages::forget(&request.id);
    if let Some(popup_window) = app.get_window(&webview_label(&request.id)?) {
        let _ = popup_window.destroy();
    }
    forget_shortcut_token(&state, &request.id);
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    silence_page(&webview);
    unregister_browser_cursor_ownership(&webview)?;
    #[cfg(target_os = "macos")]
    crate::browser::pages::url_observer::remove(&webview, &request.id);
    close_page(&webview)
}

pub(crate) fn forget_closed_pages(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrowserSessionState>() {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.retain(|id, _| {
                crate::browser::webview_label(id)
                    .is_ok_and(|label| app.get_webview(&label).is_some())
            });
        }
    }
}

pub(in crate::browser) fn silence_page(webview: &Webview) {
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
    let _ = webview.hide();
    let _ = webview.eval(
        "try { window.stop(); document.querySelectorAll('audio, video').forEach(el => { el.pause(); el.muted = true; el.src = ''; el.load(); }); } catch (_) {}"
    );
    if let Ok(blank) = tauri::Url::parse("about:blank") {
        let _ = webview.navigate(blank);
    }
}

pub(in crate::browser) fn close_page(webview: &Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|platform_webview| unsafe {
        let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
        if objc2::msg_send![view, respondsToSelector: objc2::sel!(_close)] {
            let _: () = objc2::msg_send![view, _close];
        }
    });
    webview.close().map_err(|error| error.to_string())
}
