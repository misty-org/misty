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

/// Restores a tab from its saved page state.
#[tauri::command]
pub async fn browser_page_state_restore(
    app: AppHandle,
    webview_caller: Webview,
    request: RestoreRequest,
) -> Result<RestoreReport, String> {
    require_main(&webview_caller)?;
    valid_tab(&request.view_id)?;
    let view = webview(&app, &request.runtime_id)?;
    let Some(plaintext) = window_records(&webview_caller)?
        .raw_read(
            crate::infra::profile_data::PAGE_STATE,
            &slot_id(&request.view_id, STATE_SLOT),
        )
        .await?
        .filter(|plaintext| plaintext.len() <= MAX_STATE_BYTES)
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
