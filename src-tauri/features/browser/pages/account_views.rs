use crate::browser::*;

pub(crate) fn close_account_views(app: &AppHandle) -> Result<(), String> {
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
    crate::browser::pages::app_pages::close_app_pages(app)?;
    for id in ids {
        close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    Ok(())
}
