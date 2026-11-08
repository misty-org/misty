//! Answering cookie banners and closing popups as an agent's page loads.
use super::*;

/// An agent's tab answers a cookie banner as each page loads, so it never covers the page the
/// person watches, even when the agent does not read it. Consent managers often draw the
/// banner seconds after the load, so it looks again for about ten seconds.
pub(crate) fn answer_consent_after_load(view: Webview) {
    tauri::async_runtime::spawn(async move {
        let mut consent = false;
        let mut popups = 0;
        for wait in [1_200, 1_800, 3_000, 4_000] {
            tokio::time::sleep(Duration::from_millis(wait)).await;
            if !consent {
                consent = decline_consent(&view).await.is_some();
            }
            // Popups that open with the page or a few seconds after it (page_read.js), as a
            // person closes them before reading; at most two per load.
            if popups < 2 && dismiss_popup(&view).await.is_some() {
                popups += 1;
            }
        }
    });
}

/// Closes an uninvited popup covering the page (page_read.js), and says what it pressed.
pub(super) async fn dismiss_popup(view: &Webview) -> Option<String> {
    let result = call(view, "dismissPopup", json!({}), false).await.ok()?;
    let label = result["dismissed"]
        .as_str()
        .filter(|label| !label.is_empty())?
        .to_owned();
    let _ = call(
        view,
        "settle",
        json!({"quietMs": 300, "maxMs": 1500}),
        false,
    )
    .await;
    Some(label)
}

/// Answers a cookie or consent banner the most private way before the agent reads the page
/// (page_read.js), and says which control it pressed.
pub(super) async fn decline_consent(view: &Webview) -> Option<String> {
    let result = call(view, "declineConsent", json!({}), false).await.ok()?;
    let label = result["declined"]
        .as_str()
        .filter(|label| !label.is_empty())?
        .to_owned();
    let _ = call(
        view,
        "settle",
        json!({"quietMs": 300, "maxMs": 1500}),
        false,
    )
    .await;
    Some(label)
}
