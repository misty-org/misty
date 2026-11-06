//! Page-state capture and restoration for tabs.
//!
//! Capture is two-phase: the page reports field metadata, native code
//! classifies each field, and only permitted values are then read. The saved
//! state is written to the tab's encrypted record in its window's profile.
//! Restore reads that record when the tab wakes and applies it locally; fields
//! it cannot place are returned for the agent pass, minus anything sensitive or
//! secret. Nothing here submits a form.
mod classify;
pub mod history;

use std::collections::BTreeSet;

use classify::{Class, FieldMeta};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

mod restore;
pub use restore::*;

const RUNTIME: &str = include_str!("runtime.js");
/// The slots a tab keeps, each one record: `<view id>:<slot>`.
const STATE_SLOT: &str = "state";
const HISTORY_SLOT: &str = "history";
/// A saved page's ceiling, as its slot had.
const MAX_STATE_BYTES: usize = 4 << 20;

fn valid_tab(view_id: &str) -> Result<(), String> {
    (!view_id.is_empty() && view_id.len() <= 200)
        .then_some(())
        .ok_or_else(|| "Tab identifier is invalid.".into())
}

fn slot_id(view_id: &str, slot: &str) -> String {
    format!("{view_id}:{slot}")
}

/// The records of the profile a window belongs to.
fn window_records(webview: &Webview) -> Result<crate::infra::profile_data::ProfileRecords, String> {
    crate::infra::profile_data::window_records(webview.window().label())
        .ok_or_else(|| "This computer's key storage is unavailable.".into())
}

fn webview(app: &AppHandle, runtime_id: &str) -> Result<Webview, String> {
    let valid = !runtime_id.is_empty()
        && runtime_id.len() <= 96
        && runtime_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
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
    #[cfg(any(target_os = "macos", windows))]
    let raw = super::super::browser_macos::evaluate_isolated_javascript(view.clone(), body).await?;
    #[cfg(not(any(target_os = "macos", windows)))]
    let raw: String = {
        let _ = (view, body);
        return Err("Page state is not supported on this platform.".into());
    };
    serde_json::from_str(&raw).map_err(|_| "The page returned an invalid page state.".into())
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
    view_id: String,
    /// The site is on the user's do-not-capture list: URL and scroll only.
    excluded: bool,
    force: bool,
}

/// Captures a tab's page state into its encrypted record. Returns whether a new
/// state was written. The renderer never receives field values.
#[tauri::command]
pub async fn browser_page_state_capture(
    app: AppHandle,
    webview_caller: Webview,
    request: CaptureRequest,
) -> Result<bool, String> {
    require_main(&webview_caller)?;
    valid_tab(&request.view_id)?;
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
                .filter_map(|f| {
                    Some((
                        serde_json::from_value::<FieldMeta>(f.clone()).ok()?,
                        f.clone(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let classes: Vec<Class> = metas
        .iter()
        .map(|(m, _)| classify::classify(m, request.excluded))
        .collect();
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
            if let Some(found) = values
                .as_array()
                .and_then(|v| v.iter().find(|x| x["key"] == meta.key.as_str()))
            {
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
        if !raw["visible"].as_bool().unwrap_or(false)
            && value.as_object().is_none_or(|o| o.is_empty())
            && class != Class::Secret
        {
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
        title: described["title"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(512)
            .collect(),
        scroll: described["scroll"].clone(),
        fields: if request.excluded { Vec::new() } else { fields },
        ui: if request.excluded {
            json!({})
        } else {
            described["ui"].clone()
        },
        media: described["media"].clone(),
        fingerprint: described["fingerprint"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        captured_at: now_ms(),
    };
    let plaintext = serde_json::to_vec(&saved).map_err(|_| "Could not encode page state")?;
    if plaintext.len() > MAX_STATE_BYTES {
        return Err("This page's state exceeds the size limit.".into());
    }
    window_records(&webview_caller)?
        .raw_write(
            crate::infra::profile_data::PAGE_STATE,
            &slot_id(&request.view_id, STATE_SLOT),
            Some(plaintext),
        )
        .await?;
    Ok(true)
}

fn require_main(webview: &Webview) -> Result<(), String> {
    crate::infra::profile_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Page state is only available to the main window.".into())
}
