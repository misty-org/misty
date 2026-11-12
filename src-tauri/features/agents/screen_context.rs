pub mod region;
#[cfg(windows)]
pub mod windows;

#[cfg(target_os = "macos")]
mod macos;
fn trusted(window: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(window.label()) {
        Ok(())
    } else {
        Err("Screen context is available only to Misty.".into())
    }
}
#[tauri::command]
pub async fn misty_screen_status(
    window: tauri::Webview,
    request: bool,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || macos::status(request))
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        let _ = request;
        Ok(crate::agents::screen_context::windows::status())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = request;
        Ok(serde_json::json!({"supported":false,"allowed":false}))
    }
}
#[tauri::command]
pub async fn misty_screen_capture(window: tauri::Webview) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(macos::capture)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(crate::agents::screen_context::windows::capture)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Err("Screen context isn't available on this system.".into())
    }
}

#[tauri::command]
pub fn misty_workspace_focused(window: tauri::Webview) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(window.label()) {
        return Err("Only the workspace can update its focus.".into());
    }
    #[cfg(target_os = "macos")]
    macos::main_focused();
    #[cfg(windows)]
    crate::agents::screen_context::windows::workspace_focused();
    Ok(())
}
