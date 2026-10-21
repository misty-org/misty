//! Which WebKit page process each web view runs in (debug builds only), to find page
//! processes that outlive their tabs: every WKWebView in every native window with its
//! process id and the Tauri label that still owns it, if any.
use super::*;

/// Lists the web views in every window, the process each runs in, and whether Tauri knows it.
pub(super) async fn processes(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(response) = request::<Value>(&bridge, &headers, &body) {
        return response;
    }
    reply(collect(&bridge.app).await)
}

#[cfg(target_os = "macos")]
async fn collect(app: &AppHandle) -> Result<Value, String> {
    // Tauri's labels by web view pointer, so a view no label owns stands out. Read off the
    // main thread: with_webview runs its closure there.
    let mut labels = std::collections::HashMap::<usize, String>::new();
    for (label, webview) in app.webviews() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let _ = webview.with_webview(move |platform| {
            let _ = tx.send(platform.inner() as usize);
        });
        if let Ok(Ok(pointer)) = tokio::time::timeout(std::time::Duration::from_secs(1), rx).await {
            labels.insert(pointer, format!("{label} in {}", webview.window().label()));
        }
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(walk(&labels));
    })
    .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn walk(labels: &std::collections::HashMap<usize, String>) -> Value {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    let Some(class) = AnyClass::get(c"WKWebView") else {
        return json!({ "views": [] });
    };
    let mut views = Vec::new();
    unsafe {
        let shared: *mut AnyObject =
            msg_send![AnyClass::get(c"NSApplication").unwrap(), sharedApplication];
        let windows: *mut AnyObject = msg_send![shared, windows];
        let count: usize = msg_send![windows, count];
        for index in 0..count {
            let window: *mut AnyObject = msg_send![windows, objectAtIndex: index];
            let number: isize = msg_send![window, windowNumber];
            let visible: bool = msg_send![window, isVisible];
            let content: *mut AnyObject = msg_send![window, contentView];
            // A view the window still holds outside its content tree (its first responder, or the
            // frame's other children), where a page left behind would hide from the content walk.
            let first: *mut AnyObject = msg_send![window, initialFirstResponder];
            let frame: *mut AnyObject = if content.is_null() {
                content
            } else {
                msg_send![content, superview]
            };
            let mut stack = vec![content, first, frame];
            let mut seen = std::collections::HashSet::new();
            while let Some(view) = stack.pop() {
                if view.is_null() || !seen.insert(view as usize) {
                    continue;
                }
                let is_web: bool = msg_send![view, isKindOfClass: class];
                if is_web {
                    let pid: i32 = msg_send![view, _webProcessIdentifier];
                    let parent: *mut AnyObject = msg_send![view, superview];
                    let attached: *mut AnyObject = msg_send![view, window];
                    views.push(json!({
                        "pid": pid, "window": number, "windowVisible": visible,
                        "label": labels.get(&(view as usize)),
                        "inWindow": !attached.is_null(), "hasParent": !parent.is_null(),
                    }));
                }
                let children: *mut AnyObject = msg_send![view, subviews];
                let total: usize = msg_send![children, count];
                for child in 0..total {
                    let next: *mut AnyObject = msg_send![children, objectAtIndex: child];
                    stack.push(next);
                }
            }
        }
    }
    // Every WebKit page process on this computer. The benchmark lists them before a pass and
    // after it: a new one no open view uses is a page that was left behind (the leak check). It
    // cannot ask macOS which are Misty's, since a dev build's are counted to its launcher.
    let processes = web_processes();
    json!({ "views": views, "tauriViews": labels.len(), "webProcesses": processes })
}

/// Every WebKit page process running on this computer.
#[cfg(target_os = "macos")]
fn web_processes() -> Vec<i32> {
    let mut pids = vec![0i32; 8192];
    let bytes =
        unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), (pids.len() * 4) as i32) };
    pids.truncate(bytes.max(0) as usize);
    pids.into_iter()
        .filter(|&pid| {
            let mut name = [0u8; 64];
            let length = pid > 0 && {
                let length =
                    unsafe { libc::proc_name(pid, name.as_mut_ptr().cast(), name.len() as u32) };
                length > 0 && &name[..length as usize] == b"com.apple.WebKit.WebContent"
            };
            length
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
async fn collect(_app: &AppHandle) -> Result<Value, String> {
    Err("Only on macOS.".into())
}
