//! Restoring a tab's saved page state, and the restricted agent pass over what it could not place.
use super::*;

#[derive(Serialize)]
pub struct AgentField {
    key: String,
    label: String,
    kind: String,
    /// Target value. Present only for `normal` fields.
    value: Value,
}

#[derive(Serialize)]
pub struct RestoreReport {
    /// "restored", "partial", "none" (no saved state), or "skipped".
    status: &'static str,
    applied: u64,
    secrets: u64,
    /// Unplaced `normal` fields the agent may try to fill.
    agent_fields: Vec<AgentField>,
    /// Unplaced sensitive fields: never sent to a model.
    withheld: u64,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    runtime_id: String,
    view_id: String,
}

/// Restores a tab from the page state the previous driver saved.
#[tauri::command]
pub async fn browser_page_state_restore(
    app: AppHandle,
    webview_caller: Webview,
    request: RestoreRequest,
) -> Result<RestoreReport, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &request.runtime_id)?;
    let (handle, workspace) = super::super::super::browser_sync::page_state_reader().await?;
    let Some(plaintext) = handle
        .read_page_slot(workspace, request.view_id, PAGE_STATE)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(RestoreReport {
            status: "none",
            applied: 0,
            secrets: 0,
            agent_fields: vec![],
            withheld: 0,
            url: String::new(),
        });
    };
    let saved: SavedPage =
        serde_json::from_slice(&plaintext).map_err(|_| "Saved page state is unreadable")?;
    let report = run(&view, json!({ "op": "apply", "state": &saved })).await?;
    let unmatched: BTreeSet<&str> = report["unmatched"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let mut agent_fields = Vec::new();
    let mut withheld = 0;
    for field in saved
        .fields
        .iter()
        .filter(|f| unmatched.contains(f.key.as_str()))
    {
        match field.class {
            Class::Normal => agent_fields.push(AgentField {
                key: field.key.clone(),
                label: if field.label.is_empty() {
                    field.key.rsplit('|').next().unwrap_or_default().to_owned()
                } else {
                    field.label.clone()
                },
                kind: field.kind.clone(),
                value: field.value.clone(),
            }),
            Class::Sensitive => withheld += 1,
            Class::Secret => {}
        }
    }
    let applied = report["applied"].as_u64().unwrap_or(0);
    let status = if unmatched.is_empty() {
        "restored"
    } else {
        "partial"
    };
    Ok(RestoreReport {
        status,
        applied,
        secrets: report["secrets"].as_u64().unwrap_or(0),
        agent_fields,
        withheld,
        url: saved.url,
    })
}

/// Current interactable controls for the agent pass. Values of sensitive or
/// secret fields are removed before they leave native code.
#[tauri::command]
pub async fn browser_page_state_controls(
    app: AppHandle,
    webview_caller: Webview,
    runtime_id: String,
) -> Result<Value, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &runtime_id)?;
    let mut controls = run(&view, json!({ "op": "controls" })).await?;
    if let Some(items) = controls.as_array_mut() {
        for item in items.iter_mut() {
            let meta: FieldMeta = serde_json::from_value(item.clone()).unwrap_or_default();
            let class = if item["role"] == "field" {
                classify::classify(&meta, false)
            } else {
                Class::Normal
            };
            if let Some(obj) = item.as_object_mut() {
                obj.remove("locators");
                obj.remove("key");
                if class != Class::Normal {
                    obj.insert("withheld".into(), json!(true));
                }
            }
        }
    }
    Ok(controls)
}

#[derive(Deserialize, Serialize)]
pub struct AgentAction {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    r#ref: Option<String>,
    #[serde(default)]
    value: Option<Value>,
    #[serde(default)]
    dy: Option<f64>,
}

/// Executes one restricted agent action: click, type, select, check, scroll.
/// Submitting and leaving the origin are refused by the page runtime.
#[tauri::command]
pub async fn browser_page_state_act(
    app: AppHandle,
    webview_caller: Webview,
    runtime_id: String,
    action: AgentAction,
) -> Result<Value, String> {
    require_main(&webview_caller)?;
    if !matches!(
        action.kind.as_str(),
        "click" | "type" | "select" | "check" | "scroll"
    ) {
        return Err("That action is not allowed while restoring.".into());
    }
    let view = webview(&app, &runtime_id)?;
    run(&view, json!({ "op": "act", "action": action })).await
}

/// Guards a tab against submission while an agent restores it, and reports
/// the time of the user's last real input so restoring can yield to them.
#[tauri::command]
pub async fn browser_page_state_guard(
    app: AppHandle,
    webview_caller: Webview,
    runtime_id: String,
    on: bool,
) -> Result<u64, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &runtime_id)?;
    run(&view, json!({ "op": "guard", "on": on })).await?;
    Ok(run(&view, json!({ "op": "user_at" }))
        .await?
        .as_u64()
        .unwrap_or(0))
}
