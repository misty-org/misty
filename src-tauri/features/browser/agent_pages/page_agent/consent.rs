use super::*;

pub(crate) fn answer_consent_after_load(view: Webview) {
    tauri::async_runtime::spawn(async move {
        let mut consent = false;
        let mut popups = 0;
        for wait in [1_200, 1_800, 3_000, 4_000] {
            tokio::time::sleep(Duration::from_millis(wait)).await;
            if !consent {
                consent = decline_consent(&view).await.is_some();
            }
            if popups < 2 && dismiss_popup(&view).await.is_some() {
                popups += 1;
            }
        }
    });
}

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
