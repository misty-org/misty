//! Page actions the agent runs: inspect, click, wait for downloads and evaluate.

use crate::browser::*;

mod click;
pub(in crate::browser) use click::click_browser;

pub(in crate::browser) async fn inspect_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let webview = app
        .get_webview(&webview_label(id)?)
        .ok_or("Browser tab is not running.")?;
    let observed_url = webview.url().map_err(|error| error.to_string())?;
    let target = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        let session = sessions.get(id).ok_or("Browser tab is not running.")?;
        browser_target_observation(session, &observed_url)
    };
    if target["authentication"] == "required" {
        if let Some(session) = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?
            .get_mut(id)
        {
            session.element_targets.clear();
        }
        let mut safe_url = observed_url.clone();
        safe_url.set_query(None);
        safe_url.set_fragment(None);
        return Ok(
            json!({"documentId":uuid::Uuid::new_v4().to_string(),"url":safe_url.to_string(),"title":"Sign-in required","text":"Complete sign-in in the original browser. Request user action before continuing.","truncated":true,"interactive":[],"contentTrust":"untrusted-web-page","target":target}),
        );
    }
    let document_id = uuid::Uuid::new_v4().to_string();
    let nonce = serde_json::to_string(&document_id).map_err(|error| error.to_string())?;
    let script = format!(
        "({})({nonce}, {MAX_SNAPSHOT_CHARS}, {MAX_INTERACTIVE_ELEMENTS}, ({}))",
        include_str!("../kiri_link/scripts/inspection_snapshot.js"),
        include_str!("../kiri_link/scripts/semantic_snapshot.js")
    );
    if request
        .input
        .get("extensionId")
        .is_some_and(|id| !id.is_null())
    {
        return Err("Extensions are not available.".into());
    }
    let raw = eval_json(webview.clone(), script).await?;
    if webview.url().map_err(|error| error.to_string())? != observed_url {
        return Err("browser_document_changed: inspect the current page again".into());
    }
    let snapshot: RawSnapshot = serde_json::from_value(raw)
        .map_err(|error| format!("Browser snapshot was invalid: {error}"))?;
    if !snapshot.error.is_empty() {
        return Err(snapshot.error);
    }
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    let grant = session
        .grants
        .get(&request.grant_id)
        .filter(|grant| grant.expires_at > Utc::now())
        .ok_or_else(|| "Browser agent access was revoked.".to_owned())?;
    if !grant.capabilities.contains("browser.inspect")
        && !grant.capabilities.contains("browser.visual")
    {
        return Err("Browser inspection is not granted.".to_owned());
    }
    let interactive = replace_snapshot_targets(session, snapshot.interactive);
    Ok(json!({
        "documentId": document_id,
        "url": observed_url.to_string(), "title": snapshot.title, "text": snapshot.text,
        "truncated": snapshot.truncated, "interactive": interactive, "semantic": snapshot.semantic,
        "contentTrust": "untrusted-web-page", "target":target
    }))
}

pub(in crate::browser) fn browser_target_observation(
    session: &BrowserSession,
    url: &url::Url,
) -> Value {
    let provider = session
        .profile_provider
        .as_deref()
        .or(session.provider_id.as_deref());
    let callback_page = session
        .oauth_callback
        .as_ref()
        .is_some_and(|(callback, _)| {
            url::Url::parse(&callback.url).is_ok_and(|expected| {
                expected.origin() == url.origin() && expected.path() == url.path()
            })
        });
    let required =
        callback_page || crate::browser::provider_accounts::authentication_required(provider, url);
    let mut target = json!({"scopeId":session.scope_id,"origin":browser_page_origin(url),"authentication":if required {"required"} else {"unknown"},"accountIdentity":"unverified","trust":"host-observation","observedAt":Utc::now().to_rfc3339()});
    if let Some(profile) = session.context_profile_id() {
        target["profileId"] = json!(profile);
    }
    if let Some(provider) = provider {
        target["providerId"] = json!(provider);
    }
    target
}

pub(in crate::browser) fn replace_snapshot_targets(
    session: &mut BrowserSession,
    elements: Vec<RawInteractiveElement>,
) -> Vec<Value> {
    session.snapshot_generation = session.snapshot_generation.wrapping_add(1);
    session.element_targets.clear();
    let generation = session.snapshot_generation;
    elements
        .into_iter()
        .enumerate()
        .map(|(index, element)| {
            let element_ref = format!("element-{generation}-{index}");
            session
                .element_targets
                .insert(element_ref.clone(), element.target);
            json!({"ref": element_ref, "tag": element.tag, "role": element.role, "name": element.name})
        })
        .collect()
}

pub(in crate::browser) async fn wait_for_agent_download(
    state: &BrowserSessionState,
    id: &str,
    grant_id: &str,
    existing_download_ids: &HashSet<String>,
) -> Result<BrowserDownload, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    loop {
        {
            let sessions = state
                .sessions
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            let session = sessions
                .get(id)
                .ok_or_else(|| "The granted browser tab was closed.".to_owned())?;
            let grant = session
                .grants
                .get(grant_id)
                .filter(|grant| grant.expires_at > Utc::now())
                .ok_or_else(|| "Browser agent access was revoked.".to_owned())?;
            if !grant.capabilities.contains("browser.click") {
                return Err("Browser clicks are no longer granted.".to_owned());
            }
            if let Some(download) = session.downloads.iter().rev().find(|download| {
                download.grant_id.as_deref() == Some(grant_id)
                    && !existing_download_ids.contains(&download.download_id)
                    && matches!(download.state.as_str(), "finished" | "failed")
            }) {
                return Ok(download.clone());
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "The expected browser download did not start or finish in time.".to_owned(),
            );
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

pub(in crate::browser) async fn eval_json(
    webview: Webview,
    script: String,
) -> Result<Value, String> {
    let script = format!(
        "{}\n{}",
        include_str!("../kiri_link/scripts/agent_cursor.js"),
        script
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(script, move |value| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(value);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let serialized = tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "Browser page evaluation timed out.".to_owned())?
        .map_err(|_| "Browser page evaluation was canceled.".to_owned())?;
    serde_json::from_str(&serialized)
        .map_err(|error| format!("Browser page returned invalid data: {error}"))
}
