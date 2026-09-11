use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
extern "C" {
    fn misty_context_main_focused();
    fn misty_context_configure_window(pointer: *mut std::ffi::c_void);
    fn misty_context_start(toggle: extern "C" fn());
    fn misty_context_status(request: bool) -> *mut std::ffi::c_char;
    fn misty_context_capture() -> *mut std::ffi::c_char;
}
#[cfg(target_os = "macos")]
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();
#[cfg(target_os = "macos")]
extern "C" fn toggle() {
    if let Some(app) = APP.get() {
        if let Some(window) = app.get_webview_window("misty-bot-pet") {
            let _ = window.show();
            let _ = window.emit("misty://desktop-panel-toggle", ());
        }
    }
}
pub fn setup(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("misty-bot-pet") {
            if let Ok(pointer) = window.ns_window() {
                unsafe {
                    misty_context_configure_window(pointer);
                }
            }
        }
        let _ = APP.set(app.clone());
        unsafe {
            misty_context_start(toggle);
        }
    }
}
fn trusted(window: &tauri::Webview) -> Result<(), String> {
    if matches!(window.label(), "main" | "misty-bot-pet") {
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
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({"supported":false,"allowed":false}))
    }
}
#[tauri::command]
pub async fn misty_screen_capture(
    window: tauri::Webview,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| unsafe { json(misty_context_capture()) })
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Screen context requires macOS 14 or later.".into())
    }
}

#[tauri::command]
pub fn misty_workspace_focused(window: tauri::Webview) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the workspace can update its focus.".into());
    }
    #[cfg(target_os = "macos")]
    unsafe {
        misty_context_main_focused();
    }
    Ok(())
}
