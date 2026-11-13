//! Commands for a page's context menu.

use crate::browser::*;

#[tauri::command]
pub fn browser_context_menu_select(
    app: AppHandle,
    webview: Webview,
    key: String,
    action: String,
) -> Result<(), String> {
    crate::browser::menus::context_menu::select(&app, &webview, &key, &action)
}
