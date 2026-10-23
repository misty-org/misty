//! Page actions the agent runs: inspect, click, wait for downloads and evaluate.

use super::*;

pub(super) async fn inspect_browser(
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
        include_str!("scripts/inspection_snapshot.js"),
        include_str!("scripts/semantic_snapshot.js")
    );
    let extension_id = request
        .input
        .get("extensionId")
        .and_then(super::super::extensions::agent_extension_id);
    let raw = if let Some(extension) = extension_id.clone() {
        super::super::extensions::agent_action("popup-evaluate", Some(extension), id, Some(script))
            .await?["result"]
            .clone()
    } else {
        eval_json(webview.clone(), script).await?
    };
    let extension_actions = super::super::extensions::agent_action("actions", None, id, None)
        .await
        .unwrap_or_else(|_| json!({"actions":[]}));
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
    session.snapshot_extension = extension_id.clone();
    let interactive = replace_snapshot_targets(session, snapshot.interactive);
    Ok(json!({
        "documentId": document_id,
        "url": observed_url.to_string(), "title": snapshot.title, "text": snapshot.text,
        "truncated": snapshot.truncated, "interactive": interactive, "semantic": snapshot.semantic,
        "contentTrust": "untrusted-web-page", "target":target,"extensionId":extension_id,"extensions":extension_actions["actions"]
    }))
}

pub(super) fn browser_target_observation(session: &BrowserSession, url: &url::Url) -> Value {
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
        callback_page || super::super::browser_provider::authentication_required(provider, url);
    let mut target = json!({"scopeId":session.scope_id,"origin":browser_page_origin(url),"authentication":if required {"required"} else {"unknown"},"accountIdentity":"unverified","trust":"host-observation","observedAt":Utc::now().to_rfc3339()});
    if let Some(profile) = session.context_profile_id() {
        target["profileId"] = json!(profile);
    }
    if let Some(provider) = provider {
        target["providerId"] = json!(provider);
    }
    target
}

pub(super) fn replace_snapshot_targets(
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

pub(super) async fn click_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    agent_id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let element_ref = request
        .input
        .get("elementRef")
        .and_then(Value::as_str)
        .ok_or_else(|| "An inspected element reference is required.".to_owned())?;
    let expect_download = request
        .input
        .get("expectDownload")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (target, existing_download_ids) = {
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
        if !grant.capabilities.contains("browser.click") {
            return Err("Browser clicks are not granted.".to_owned());
        }
        let selector = session
            .element_targets
            .get(element_ref)
            .cloned()
            .ok_or_else(|| "The page changed; inspect it again before clicking.".to_owned())?;
        if expect_download {
            session.pending_agent_download = Some(PendingAgentDownload {
                grant_id: request.grant_id.clone(),
                agent_id: agent_id.to_owned(),
                task_id: request
                    .input
                    .get("__mistyTaskId")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned),
                expires_at: Utc::now() + chrono::Duration::seconds(AGENT_DOWNLOAD_WINDOW_SECONDS),
                popup_id: None,
            });
        }
        (
            selector,
            session
                .downloads
                .iter()
                .map(|download| download.download_id.clone())
                .collect::<HashSet<_>>(),
        )
    };
    let encoded_target = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    let script = format!(
        "({})({encoded_target})",
        include_str!("scripts/inspection_click.js")
    );
    let result = eval_json(
        app.get_webview(&webview_label(id)?)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?,
        script,
    )
    .await?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale") {
            return Err("browser_snapshot_stale: inspected content changed before dispatch".into());
        }
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Browser click failed.")
            .to_owned());
    }
    if expect_download {
        let download =
            wait_for_agent_download(state, id, &request.grant_id, &existing_download_ids).await?;
        if !download.success {
            return Err(download
                .error
                .clone()
                .unwrap_or_else(|| "The browser download failed.".to_owned()));
        }
        return Ok(json!({
            "ok": true,
            "elementRef": element_ref,
            "expectDownload": true,
            "sourceScopeId": request.scope_id,
            "download": download
        }));
    }
    Ok(json!({"ok": true, "elementRef": element_ref, "expectDownload": false}))
}

pub(super) async fn wait_for_agent_download(
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

pub(super) async fn eval_json(webview: Webview, script: String) -> Result<Value, String> {
    let script = format!("{}\n{}", include_str!("scripts/agent_cursor.js"), script);
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
