//! browser.click: a click on an inspected element, through native input when it can.
use super::*;

pub(in crate::infra::browser) async fn click_browser(
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
        include_str!("../scripts/inspection_click.js")
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
