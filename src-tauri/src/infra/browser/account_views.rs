//! Closing the pages of one account when another takes its place.
use super::*;

/// Caller holds the browser lifecycle write lease. Enumerate real native views
/// as well as registered sessions so failed/partial creation is also closed.
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
    for id in ids {
        close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    Ok(())
}
