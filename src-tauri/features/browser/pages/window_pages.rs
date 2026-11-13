//! Hiding, parking and closing all of a window's pages at once.
use crate::browser::*;

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
pub struct BrowserWebviewsCloseExceptRequest {
    pub keep: Vec<String>,
}

/// Closes the agents' pages in the caller's window that the renderer does not know. The agent
/// browser starts every tab asleep after a reload and opens a new page when one is shown, so a page
/// from before the reload has no tab, never moves again and stays drawn over the window.
/// Async for the same reason as `browser_webview_close`: never close on the UI thread.
#[tauri::command]
pub async fn browser_webviews_close_except(
    caller: Webview,
    app: AppHandle,
    request: BrowserWebviewsCloseExceptRequest,
) -> Result<(), String> {
    let orphans: Vec<String> = window_pages(&caller, &app, "misty-browser-agent-", &request.keep)
        .iter()
        .filter_map(|webview| {
            webview
                .label()
                .strip_prefix("misty-browser-")
                .map(str::to_owned)
        })
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
