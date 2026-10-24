//! Hiding, parking and closing all of a window's pages at once.
use super::*;

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
