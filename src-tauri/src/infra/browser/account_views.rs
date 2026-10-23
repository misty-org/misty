//! Closing the pages that use one account's or one Space's website data store.
use super::*;

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
