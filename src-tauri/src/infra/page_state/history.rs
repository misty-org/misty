//! Per-tab browsing history in the tab's encrypted history slot, so back and
//! forward keep working on another device and across restarts. The renderer
//! owns the history model and its size budget; native code only bounds the
//! payload and moves it in and out of the driven tree.
use misty_browser_sync::tree::protocol::SLOT_HISTORY;
use tauri::Webview;

/// Hard ceiling matching the renderer's 1 MB setting maximum.
const MAX_HISTORY_BYTES: usize = 1 << 20;

fn valid_tab(tab_id: &str) -> Result<(), String> {
    (!tab_id.is_empty() && tab_id.len() <= 200).then_some(()).ok_or_else(|| "Tab identifier is invalid.".into())
}

#[tauri::command]
pub async fn browser_tab_history_save(webview: Webview, tab_id: String, history: Option<String>) -> Result<(), String> {
    super::require_main(&webview)?;
    valid_tab(&tab_id)?;
    if history.as_ref().is_some_and(|h| h.len() > MAX_HISTORY_BYTES) {
        return Err("Tab history exceeds the 1 MB limit.".into());
    }
    let handle = super::super::browser_sync::page_state_worker().await?;
    handle
        .write_tab_slot(tab_id, SLOT_HISTORY, history.map(String::into_bytes))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_tab_history_load(webview: Webview, tab_id: String) -> Result<Option<String>, String> {
    super::require_main(&webview)?;
    valid_tab(&tab_id)?;
    let (handle, tree) = super::super::browser_sync::page_state_reader().await?;
    let bytes = handle.read_tab_slot(tree, tab_id, SLOT_HISTORY).await.map_err(|e| e.to_string())?;
    Ok(bytes.filter(|b| b.len() <= MAX_HISTORY_BYTES).and_then(|b| String::from_utf8(b).ok()))
}
