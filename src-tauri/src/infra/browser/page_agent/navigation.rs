//! A tab's first load and the page a navigation lands on.
use super::*;

/// A new agent tab's first page, loaded: it has left about:blank and reports ready, and a bot
/// check is waited out as in `landed`. Without it a new tab's first read was a blank page, and a
/// run that opened tabs in batches worked from blanks (Odysseys, October 20). True once loaded.
pub(in crate::infra::browser) async fn first_load(app: &AppHandle, id: &str) -> bool {
    let started = tokio::time::Instant::now();
    loop {
        let elapsed = started.elapsed();
        if let Ok(view) = webview(app, id) {
            let blank = view
                .url()
                .map(|url| url.as_str() == "about:blank")
                .unwrap_or(true);
            let check = call(&view, "waitCheck", json!({}), false).await.ok();
            let ready = check.as_ref().is_some_and(|check| check["ready"] == true);
            let challenge = check
                .as_ref()
                .is_some_and(|check| check["challenge"] == true);
            if !blank && ready && !(challenge && elapsed < Duration::from_secs(20)) {
                return true;
            }
            if elapsed > Duration::from_secs(if blank { 15 } else { 25 }) {
                return false;
            }
        } else if elapsed > Duration::from_secs(15) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// Marks the tab's document before a navigation (page_read.js), so `landed` can tell the new
/// page from the old one still showing. None when the page did not answer.
pub(in crate::infra::browser) async fn mark_document(app: &AppHandle, id: &str) -> Option<String> {
    let view = webview(app, id).ok()?;
    let token = uuid::Uuid::new_v4().to_string();
    let marked = call(&view, "mark", json!({ "token": token }), false)
        .await
        .ok()?;
    (marked["ok"] == true).then_some(token)
}

/// The page a navigation lands on, once its document has loaded and gone quiet, as the
/// model reads it: the agent sees the new page in the same step instead of guessing its
/// next look (docs/plans/odysseys-campaign.md). None when the page never answered.
///
/// With the old document's `mark`, a page counts as landed only when another document
/// replaced it, or the same one moved to the target (a fragment). A bot check that passes
/// by waiting is waited out. When the old page is still showing at the end, the snapshot
/// says so, instead of passing the old page off as the new one.
pub(in crate::infra::browser) async fn landed(
    app: &AppHandle,
    id: &str,
    previous: &url::Url,
    target: &url::Url,
    mark: Option<&str>,
) -> Option<Value> {
    let started = tokio::time::Instant::now();
    let mut arrived;
    let mut challenge;
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let view = webview(app, id).ok()?;
        let url = view.url().ok();
        let check = call(&view, "waitCheck", json!({}), false).await.ok();
        let ready = check.as_ref().is_some_and(|check| check["ready"] == true);
        challenge = check
            .as_ref()
            .is_some_and(|check| check["challenge"] == true);
        let fragment = previous != target && url.as_ref() == Some(target);
        arrived = match mark {
            Some(token) => {
                fragment
                    || check
                        .as_ref()
                        .is_some_and(|check| check["mark"].as_str() != Some(token))
            }
            None => {
                url.as_ref() != Some(previous)
                    || (previous == target && started.elapsed() > Duration::from_millis(1200))
            }
        };
        let elapsed = started.elapsed();
        if (arrived && ready && !(challenge && elapsed < Duration::from_secs(20)))
            || elapsed > Duration::from_secs(if arrived { 25 } else { 15 })
        {
            break;
        }
    }
    let view = webview(app, id).ok()?;
    let _ = call(
        &view,
        "settle",
        json!({"quietMs": 400, "maxMs": 3000}),
        false,
    )
    .await;
    let declined = decline_consent(&view).await;
    let args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "maxChars": SNAPSHOT_CHARS, "maxRefs": 800});
    let mut snapshot = call(&view, "snapshot", args, true).await.ok()?;
    if let Some(label) = declined {
        snapshot["consentDeclined"] = json!(label);
    }
    with_frame_trees(&view, &mut snapshot).await;
    let note = if !arrived {
        Some(format!("This tab still shows the page it was on: {target} did not load (the address may not exist, or the site is slow). Check the address, or search for the site to find its real one."))
    } else if challenge {
        Some("This site is showing a bot check that did not clear by waiting. Do not try to solve it: try another page of the site, a search result that links into it, or another source.".to_owned())
    } else {
        None
    };
    if let (Some(note), Some(tree)) = (note, snapshot["tree"].as_str()) {
        snapshot["tree"] = json!(format!("- note: {note}\n{tree}"));
    }
    (snapshot["ok"] == true).then(|| {
        json!({"documentId": snapshot["documentId"], "url": snapshot["url"], "title": snapshot["title"],
            "tree": snapshot["tree"], "truncated": snapshot["truncated"], "skills": snapshot["skills"],
            "consentDeclined": snapshot["consentDeclined"], "loaded": arrived})
    })
}
