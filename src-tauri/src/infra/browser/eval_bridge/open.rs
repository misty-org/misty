//! Opening a benchmark task's tab with its lease and grant.
use super::*;

pub(super) async fn open_tab(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match request::<OpenTab>(&bridge, &headers, &body) {
        Ok(body) => reply(open(&bridge, body).await),
        Err(response) => response,
    }
}

pub(super) async fn open(bridge: &Bridge, body: OpenTab) -> Result<Value, String> {
    let app = &bridge.app;
    let url = external_url(&body.url)?;
    let id = format!("eval-{}", uuid::Uuid::new_v4());
    let scope = format!("eval-scope-{}", uuid::Uuid::new_v4());
    let task = uuid::Uuid::new_v4().to_string();
    workspace::agent_workspace_acquire(
        main_view(app)?,
        app.state::<AgentWorkspaceState>(),
        serde_json::from_value(lease(&task, false)).map_err(|e| e.to_string())?,
    )?;
    let created = async {
        browser_webview_create(
            main_view(app)?,
            app.clone(),
            app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({
                "id": id, "scopeId": scope, "url": url.as_str(),
                "x": 0, "y": 64, "width": 1280, "height": 860,
            }))
            .map_err(|e| e.to_string())?,
        )
        .await?;
        workspace::agent_workspace_bind_scope(
            main_view(app)?,
            app.clone(),
            app.state::<AgentWorkspaceState>(),
            task.clone(),
            scope.clone(),
            None,
        )?;
        browser_agent_grant_register(
            app.clone(),
            app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({
                "id": id, "scopeId": scope, "grantId": grant(&scope), "agentId": AGENT,
                "capabilities": CAPABILITIES,
                "expiresAt": (Utc::now() + chrono::Duration::hours(2)).to_rfc3339(),
            }))
            .map_err(|e| e.to_string())?,
        )?;
        // Some sites (Google Docs and Sheets) wait until the page is on screen,
        // so a visible tab also brings Misty's window forward.
        if body.visible {
            let window = main_view(app)?.window();
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        // Agents' own tabs are parked out of sight, still rendering, as in production.
        if !body.visible {
            browser_webview_hide(
                main_view(app)?,
                app.clone(),
                serde_json::from_value(json!({ "id": id, "keepLive": true }))
                    .map_err(|e| e.to_string())?,
            )?;
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = created {
        let _ = close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({ "id": id })).map_err(|e| e.to_string())?,
        );
        if let Ok(view) = main_view(app) {
            let _ = workspace::agent_workspace_release(
                view,
                app.state::<AgentWorkspaceState>(),
                task.clone(),
            );
        }
        return Err(error);
    }
    // The native lease lasts 30 seconds; keep it while the tab is open.
    let renew_app = app.clone();
    let renew_task = task.clone();
    let renew = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            let Ok(view) = main_view(&renew_app) else {
                return;
            };
            let Ok(request) = serde_json::from_value(lease(&renew_task, true)) else {
                return;
            };
            if workspace::agent_workspace_acquire(
                view,
                renew_app.state::<AgentWorkspaceState>(),
                request,
            )
            .is_err()
            {
                return;
            }
        }
    });
    bridge
        .tabs
        .lock()
        .await
        .insert(scope.clone(), Tab { id, task, renew });
    Ok(json!({ "scopeId": scope }))
}

pub(super) fn grant(scope: &str) -> String {
    format!("eval-grant-{scope}")
}
