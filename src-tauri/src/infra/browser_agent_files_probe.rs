//! Disposable native WebKit proof; no accounts or external provider effects.
use super::*;
use crate::infra::agent_workspace::{self, AgentWorkspaceState};

async fn act(
    app: &AppHandle,
    scope: &str,
    task: &str,
    operation: &str,
    mut input: Value,
) -> Result<Value, String> {
    input["__mistyTaskId"] = json!(task);
    browser_agent_execute(app.clone(), app.state::<BrowserSessionState>(), serde_json::from_value(json!({
        "scopeId":scope,"grantId":format!("grant-{scope}"),"agentId":"fixture-agent","operation":operation,"input":input
    })).map_err(|e| e.to_string())?).await
}

async fn element(app: &AppHandle, scope: &str, task: &str, name: &str) -> Result<Value, String> {
    let snapshot = act(app, scope, task, "browser.inspect", json!({})).await?;
    let item = snapshot["interactive"]
        .as_array()
        .ok_or("missing elements")?
        .iter()
        .find(|item| item["name"] == name)
        .ok_or_else(|| format!("Missing {name}: {snapshot}"))?;
    Ok(json!({"documentId":snapshot["documentId"],"elementRef":item["ref"]}))
}

fn acquire(app: &AppHandle, task: &str) -> Result<(), String> {
    agent_workspace::agent_workspace_acquire(app.get_webview("main").ok_or("main view missing")?, app.state::<AgentWorkspaceState>(),
        serde_json::from_value(json!({"accountId":"fixture-owner","agentId":"fixture-agent","spaceId":"fixture-space","taskId":task})).map_err(|e|e.to_string())?)?;
    Ok(())
}

fn bind(app: &AppHandle, scope: &str, task: &str, previous: Option<&str>) -> Result<(), String> {
    agent_workspace::agent_workspace_bind_scope(
        app.get_webview("main").ok_or("main view missing")?,
        app.clone(),
        app.state::<AgentWorkspaceState>(),
        task.into(),
        scope.into(),
        previous.map(str::to_owned),
    )
}

pub(crate) async fn run(app: AppHandle, origin: String) -> Result<String, String> {
    let origin = Url::parse(&origin).map_err(|e| e.to_string())?;
    if origin.scheme() != "http" || !matches!(origin.host_str(), Some("127.0.0.1" | "localhost")) {
        return Err("Loopback fixture required".into());
    }
    acquire(&app, "fixture-task")?;
    for (index, id) in ["source", "destination"].iter().enumerate() {
        let scope = format!("fixture-{id}");
        let url = origin
            .join("/cli/tasks/browser-agent-files-fixture.html")
            .map_err(|e| e.to_string())?;
        browser_webview_create(app.get_webview("main").ok_or("main view missing")?, app.clone(), app.state::<BrowserSessionState>(),
            serde_json::from_value(json!({"id":id,"scopeId":scope,"url":url,"x":index*500,"y":60,"width":490,"height":500})).map_err(|e|e.to_string())?).await?;
        bind(&app, &scope, "fixture-task", None)?;
        browser_agent_grant_register(app.state::<BrowserSessionState>(), serde_json::from_value(json!({
            "id":id,"scopeId":scope,"grantId":format!("grant-{scope}"),"agentId":"fixture-agent",
            "expiresAt":(Utc::now()+chrono::Duration::minutes(3)).to_rfc3339(),
            "capabilities":["browser.inspect","browser.click","browser.upload","browser.downloads.list"]
        })).map_err(|e|e.to_string())?)?;
        let view = app.get_webview(&webview_label(id)?).ok_or("view missing")?;
        let mut ready = false;
        for _ in 0..100 {
            if evaluate_browser_async_javascript(
                view.clone(),
                "return JSON.stringify(document.body?.dataset.ready==='true')".into(),
            )
            .await?
                == "true"
            {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if !ready {
            return Err("fixture did not load".into());
        }
    }
    let mut receipts = Vec::new();
    for name in ["Download test image", "Download test catalog", "Download popup catalog", "Download attachment catalog"] {
        let mut input = element(&app, "fixture-source", "fixture-task", name).await?;
        input["expectDownload"] = json!(true);
        let output = act(
            &app,
            "fixture-source",
            "fixture-task",
            "browser.click",
            input,
        )
        .await.map_err(|error| format!("{name}: {error}"))?;
        if output["download"]["file"]["sha256"].as_str().is_none() {
            return Err(format!("missing verified download: {output}"));
        }
        receipts.push(output["download"].clone());
    }
    agent_workspace::agent_workspace_release(
        app.get_webview("main").ok_or("main view missing")?,
        app.state::<AgentWorkspaceState>(),
        "fixture-task".into(),
    )?;
    if act(
        &app,
        "fixture-source",
        "fixture-task",
        "browser.inspect",
        json!({}),
    )
    .await
    .is_ok()
    {
        return Err("paused task retained access".into());
    }
    acquire(&app, "fixture-resumed")?;
    bind(
        &app,
        "fixture-source",
        "fixture-resumed",
        Some("fixture-task"),
    )?;
    bind(
        &app,
        "fixture-destination",
        "fixture-resumed",
        Some("fixture-task"),
    )?;
    for receipt in &receipts {
        let mut input = element(
            &app,
            "fixture-destination",
            "fixture-resumed",
            "Upload task file",
        )
        .await?;
        input["sourceScopeId"] = json!("fixture-source");
        input["downloadId"] = receipt["downloadId"].clone();
        let result = act(
            &app,
            "fixture-destination",
            "fixture-resumed",
            "browser.upload",
            input,
        )
        .await?;
        if result["inputSelected"] != true || result["websiteUploadVerified"] != false {
            return Err(format!("incorrect upload receipt: {result}"));
        }
        let view = app
            .get_webview(&webview_label("destination")?)
            .ok_or("destination closed")?;
        let mut verified = false;
        for _ in 0..50 {
            let raw = evaluate_browser_async_javascript(
                view.clone(),
                "return document.querySelector('#result').textContent".into(),
            )
            .await?;
            if let Ok(observed) = serde_json::from_str::<Value>(&raw) {
                if observed["sha256"] == receipt["file"]["sha256"] {
                    verified = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if !verified {
            return Err("destination did not receive exact file bytes".into());
        }
        // Capture actual WebKit rendering of the action cursor for visual QA.
        let capture =
            super::super::browser_macos::capture_webview_region(view, 0., 0., 490., 500.).await?;
        if let Some(url) = capture["dataUrl"].as_str() {
            use base64::Engine;
            if let Some((_, encoded)) = url.split_once(',') {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|e| e.to_string())?;
                std::fs::write(
                    std::env::temp_dir().join("misty-agent-files-cursor.png"),
                    bytes,
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok("PASS native WebKit: PNG, blob PDF, popup PDF and HTTP attachment PDF downloads → original task verified receipts → pause/revoke → fresh task authority → upload into another webview → matching SHA-256 at destination. Synthetic pages only; real provider acceptance pending.".into())
}
