//! Per-tab browsing history in the tab's encrypted record, so back and forward
//! keep working across restarts. The renderer owns the history model and its size
//! budget; native code only bounds the payload and moves it in and out of the
//! window's profile.
use super::{slot_id, valid_tab, window_records, HISTORY_SLOT};
use crate::browser::profiles::PAGE_STATE;
use tauri::Webview;

/// Hard ceiling matching the renderer's 1 MB setting maximum.
const MAX_HISTORY_BYTES: usize = 1 << 20;

#[tauri::command]
pub async fn browser_view_history_save(
    webview: Webview,
    view_id: String,
    history: Option<String>,
) -> Result<(), String> {
    super::require_main(&webview)?;
    valid_tab(&view_id)?;
    if history
        .as_ref()
        .is_some_and(|h| h.len() > MAX_HISTORY_BYTES)
    {
        return Err("Tab history exceeds the 1 MB limit.".into());
    }
    window_records(&webview)?
        .raw_write(
            PAGE_STATE,
            &slot_id(&view_id, HISTORY_SLOT),
            history.map(String::into_bytes),
        )
        .await
}

#[tauri::command]
pub async fn browser_view_history_load(
    webview: Webview,
    view_id: String,
) -> Result<Option<String>, String> {
    super::require_main(&webview)?;
    valid_tab(&view_id)?;
    let bytes = window_records(&webview)?
        .raw_read(PAGE_STATE, &slot_id(&view_id, HISTORY_SLOT))
        .await?;
    Ok(bytes
        .filter(|b| b.len() <= MAX_HISTORY_BYTES)
        .and_then(|b| String::from_utf8(b).ok()))
}
