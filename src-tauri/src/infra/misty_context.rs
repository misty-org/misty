#[cfg(target_os = "macos")]
extern "C" {
    fn misty_context_main_focused();
    fn misty_context_status(request: bool) -> *mut std::ffi::c_char;
    fn misty_context_capture() -> *mut std::ffi::c_char;
}
fn trusted(window: &tauri::Webview) -> Result<(), String> {
    if crate::infra::space_windows::is_space_window(window.label()) {
        Ok(())
    } else {
        Err("Screen context is available only to Misty.".into())
    }
}
#[cfg(target_os = "macos")]
unsafe fn json(pointer: *mut std::ffi::c_char) -> Result<serde_json::Value, String> {
    if pointer.is_null() {
        return Err("Screen context is unavailable.".into());
    }
    let result = serde_json::from_slice(std::ffi::CStr::from_ptr(pointer).to_bytes())
        .map_err(|e| e.to_string());
    libc::free(pointer.cast());
    result
}
#[tauri::command]
pub async fn misty_screen_status(
    window: tauri::Webview,
    request: bool,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || unsafe { json(misty_context_status(request)) })
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(windows)]
    {
        let _ = request;
        Ok(super::misty_context_windows::status())
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
        tauri::async_runtime::spawn_blocking(|| unsafe { json(misty_context_capture()) })
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(super::misty_context_windows::capture)
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
    if !crate::infra::space_windows::is_space_window(window.label()) {
        return Err("Only the workspace can update its focus.".into());
    }
    #[cfg(target_os = "macos")]
    unsafe {
        misty_context_main_focused();
    }
    #[cfg(windows)]
    super::misty_context_windows::workspace_focused();
    Ok(())
}
