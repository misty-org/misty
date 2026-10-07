use tauri::Webview;

pub(super) const SENDER_SCRIPT: &str = "() => null";

pub(super) fn install(_webview: &Webview) -> Result<(), String> {
    Err("This platform's browser engine is not supported.".into())
}

pub(super) fn forget(_webview: &str) {}
