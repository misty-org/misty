//! Diagnostics from a window's app into the desktop log.
/// Debug builds only: one line from the app into the desktop log, prefixed with the window, for
/// timing the device worker during evals. Release builds drop it.
#[tauri::command]
pub fn diagnostic_log(webview: tauri::Webview, scope: String, message: String) {
    if cfg!(debug_assertions) {
        let scope: String = scope
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .take(40)
            .collect();
        let message: String = message
            .chars()
            .filter(|c| !c.is_control())
            .take(400)
            .collect();
        eprintln!(
            "app_diag scope={scope} window={} {message}",
            webview.window().label()
        );
    }
}
