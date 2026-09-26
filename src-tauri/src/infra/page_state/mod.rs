//! Page-state capture and restoration for synced tabs.
//!
//! Capture is two-phase: the page reports field metadata, native code
//! classifies each field, and only permitted values are then read. The saved
//! state is written to the tab's encrypted page-state slot in the tree this
//! device drives. Restore reads that slot after a device switch and applies it
//! locally; fields it cannot place are returned for the agent pass, minus
//! anything sensitive or secret. Nothing here submits a form.
mod classify;
pub mod history;

use std::collections::BTreeSet;

use classify::{Class, FieldMeta};
use misty_browser_sync::tree::protocol::SLOT_PAGE_STATE;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

const RUNTIME: &str = include_str!("runtime.js");

fn webview(app: &AppHandle, runtime_id: &str) -> Result<Webview, String> {
    let valid = !runtime_id.is_empty()
        && runtime_id.len() <= 96
        && runtime_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !valid {
        return Err("Browser tab identifier is invalid.".into());
    }
    app.get_webview(&format!("misty-browser-{runtime_id}"))
        .ok_or_else(|| "Browser page is unavailable.".into())
}

/// Runs one runtime command and returns its JSON result.
async fn run(view: &Webview, command: Value) -> Result<Value, String> {
    let body = format!(
        "{RUNTIME}\nreturn JSON.stringify(globalThis.__mistyPageState.run({command}) ?? null);"
    );
    #[cfg(target_os = "macos")]
    let raw = super::browser_macos::evaluate_isolated_javascript(view.clone(), body).await?;
    #[cfg(windows)]
    let raw = windows_eval(view, format!("(() => {{ {body} }})()")).await?;
    #[cfg(not(any(target_os = "macos", windows)))]
    let raw: String = {
        let _ = (view, body);
        return Err("Page state is not supported on this platform.".into());
    };
    serde_json::from_str(&raw).map_err(|_| "The page returned an invalid page state.".into())
}

/// WebView2 has no isolated script world; the runtime runs in the page world
/// there. It still never submits or navigates across origins.
#[cfg(windows)]
async fn windows_eval(view: &Webview, script: String) -> Result<String, String> {
    use std::sync::{Arc, Mutex};
    use webview2_com::ExecuteScriptCompletedHandler;
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(Mutex::new(Some(send)));
    view.with_webview(move |platform| unsafe {
        let reply = send.clone();
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |status, result: String| {
            if let Some(send) = reply.lock().ok().and_then(|mut s| s.take()) {
                // ExecuteScript JSON-encodes the returned string once more.
                let decoded = serde_json::from_str::<String>(&result).unwrap_or_else(|_| "null".into());
                let _ = send.send(if status.is_ok() { Ok(decoded) } else { Err("The page could not run page-state code.".to_string()) });
            }
            Ok(())
        }));
        let started = platform
            .controller()
            .CoreWebView2()
            .and_then(|core| core.ExecuteScript(&windows::core::HSTRING::from(script.as_str()), &handler));
        if started.is_err() {
            if let Some(send) = send.lock().ok().and_then(|mut s| s.take()) {
                let _ = send.send(Err("The page could not run page-state code.".to_string()));
            }
        }
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await
        .map_err(|_| "Page state timed out.".to_string())?
        .map_err(|_| "Page state was canceled.".to_string())?
}

#[derive(Serialize, Deserialize, Clone)]
struct SavedField {
    key: String,
    tag: String,
    #[serde(rename = "type")]
    kind: String,
    label: String,
    locators: Vec<(String, String)>,
    class: Class,
    #[serde(flatten)]
    value: Value,
}

#[derive(Serialize, Deserialize)]
struct SavedPage {
    v: u8,
    url: String,
    title: String,
    scroll: Value,
    fields: Vec<SavedField>,
    ui: Value,
    media: Value,
    fingerprint: String,
    captured_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn http_url(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    runtime_id: String,
    tab_id: String,
    /// The site is on the user's do-not-capture list: URL and scroll only.
    excluded: bool,
    force: bool,
}

/// Captures a tab's page state into its encrypted slot. Returns whether a new
/// state was written. The renderer never receives field values.
#[tauri::command]
pub async fn browser_page_state_capture(app: AppHandle, webview_caller: Webview, request: CaptureRequest) -> Result<bool, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &request.runtime_id)?;
    let described = run(&view, json!({ "op": "describe", "force": request.force })).await?;
    if described.is_null() {
        return Ok(false);
    }
    let url = described["url"].as_str().unwrap_or_default().to_owned();
    if !http_url(&url) {
        return Ok(false);
    }
    let metas: Vec<(FieldMeta, Value)> = described["fields"]
        .as_array()
        .map(|fields| {
            fields
                .iter()
                .filter_map(|f| Some((serde_json::from_value::<FieldMeta>(f.clone()).ok()?, f.clone())))
                .collect()
        })
        .unwrap_or_default();
    let classes: Vec<Class> = metas.iter().map(|(m, _)| classify::classify(m, request.excluded)).collect();
    let wanted: Vec<&str> = metas
        .iter()
        .zip(&classes)
        .filter(|(_, c)| **c != Class::Secret)
        .map(|((m, _), _)| m.key.as_str())
        .collect();
    let values = if wanted.is_empty() {
        Value::Array(vec![])
    } else {
        run(&view, json!({ "op": "values", "keys": wanted })).await?
    };
    let mut fields = Vec::new();
    for ((meta, raw), class) in metas.iter().zip(classes) {
        let mut class = class;
        let mut value = json!({});
        if class != Class::Secret {
            if let Some(found) = values.as_array().and_then(|v| v.iter().find(|x| x["key"] == meta.key.as_str())) {
                let text = found["value"].as_str().unwrap_or_default();
                if classify::secret_shaped(text) {
                    // Drop the value entirely; it never reaches storage.
                    class = Class::Secret;
                } else {
                    if class == Class::Normal && classify::long_free_text(text) {
                        class = Class::Sensitive;
                    }
                    value = found.clone();
                    if let Some(obj) = value.as_object_mut() {
                        obj.remove("key");
                    }
                }
            }
        }
        if !raw["visible"].as_bool().unwrap_or(false) && value.as_object().is_none_or(|o| o.is_empty()) && class != Class::Secret {
            continue;
        }
        fields.push(SavedField {
            key: meta.key.clone(),
            tag: meta.tag.clone(),
            kind: meta.kind.clone(),
            label: meta.label.clone(),
            locators: serde_json::from_value(raw["locators"].clone()).unwrap_or_default(),
            class,
            value,
        });
    }
    let saved = SavedPage {
        v: 1,
        url,
        title: described["title"].as_str().unwrap_or_default().chars().take(512).collect(),
        scroll: described["scroll"].clone(),
        fields: if request.excluded { Vec::new() } else { fields },
        ui: if request.excluded { json!({}) } else { described["ui"].clone() },
        media: described["media"].clone(),
        fingerprint: described["fingerprint"].as_str().unwrap_or_default().to_owned(),
        captured_at: now_ms(),
    };
    let plaintext = serde_json::to_vec(&saved).map_err(|_| "Could not encode page state")?;
    let handle = super::browser_sync::page_state_worker().await?;
    handle.write_tab_slot(request.tab_id, SLOT_PAGE_STATE, Some(plaintext)).await.map_err(|e| e.to_string())?;
    Ok(true)
}

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
    tab_id: String,
}

/// Restores a tab from the page state the previous driver saved.
#[tauri::command]
pub async fn browser_page_state_restore(app: AppHandle, webview_caller: Webview, request: RestoreRequest) -> Result<RestoreReport, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &request.runtime_id)?;
    let (handle, tree) = super::browser_sync::page_state_reader().await?;
    let Some(plaintext) = handle
        .read_tab_slot(tree, request.tab_id, SLOT_PAGE_STATE)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(RestoreReport { status: "none", applied: 0, secrets: 0, agent_fields: vec![], withheld: 0, url: String::new() });
    };
    let saved: SavedPage = serde_json::from_slice(&plaintext).map_err(|_| "Saved page state is unreadable")?;
    let report = run(&view, json!({ "op": "apply", "state": &saved })).await?;
    let unmatched: BTreeSet<&str> = report["unmatched"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let mut agent_fields = Vec::new();
    let mut withheld = 0;
    for field in saved.fields.iter().filter(|f| unmatched.contains(f.key.as_str())) {
        match field.class {
            Class::Normal => agent_fields.push(AgentField {
                key: field.key.clone(),
                label: if field.label.is_empty() { field.key.rsplit('|').next().unwrap_or_default().to_owned() } else { field.label.clone() },
                kind: field.kind.clone(),
                value: field.value.clone(),
            }),
            Class::Sensitive => withheld += 1,
            Class::Secret => {}
        }
    }
    let applied = report["applied"].as_u64().unwrap_or(0);
    let status = if unmatched.is_empty() { "restored" } else { "partial" };
    Ok(RestoreReport { status, applied, secrets: report["secrets"].as_u64().unwrap_or(0), agent_fields, withheld, url: saved.url })
}

/// Current interactable controls for the agent pass. Values of sensitive or
/// secret fields are removed before they leave native code.
#[tauri::command]
pub async fn browser_page_state_controls(app: AppHandle, webview_caller: Webview, runtime_id: String) -> Result<Value, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &runtime_id)?;
    let mut controls = run(&view, json!({ "op": "controls" })).await?;
    if let Some(items) = controls.as_array_mut() {
        for item in items.iter_mut() {
            let meta: FieldMeta = serde_json::from_value(item.clone()).unwrap_or_default();
            let class = if item["role"] == "field" { classify::classify(&meta, false) } else { Class::Normal };
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
pub async fn browser_page_state_act(app: AppHandle, webview_caller: Webview, runtime_id: String, action: AgentAction) -> Result<Value, String> {
    require_main(&webview_caller)?;
    if !matches!(action.kind.as_str(), "click" | "type" | "select" | "check" | "scroll") {
        return Err("That action is not allowed while restoring.".into());
    }
    let view = webview(&app, &runtime_id)?;
    run(&view, json!({ "op": "act", "action": action })).await
}

/// Guards a tab against submission while an agent restores it, and reports
/// the time of the user's last real input so restoring can yield to them.
#[tauri::command]
pub async fn browser_page_state_guard(app: AppHandle, webview_caller: Webview, runtime_id: String, on: bool) -> Result<u64, String> {
    require_main(&webview_caller)?;
    let view = webview(&app, &runtime_id)?;
    run(&view, json!({ "op": "guard", "on": on })).await?;
    Ok(run(&view, json!({ "op": "user_at" })).await?.as_u64().unwrap_or(0))
}

fn require_main(webview: &Webview) -> Result<(), String> {
    (webview.label() == "main").then_some(()).ok_or_else(|| "Page state is only available to the main window.".into())
}
