use crate::browser::*;

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
