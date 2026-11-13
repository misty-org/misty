use tauri::Webview;

const UNSUPPORTED: &str = "This platform's browser engine is not supported.";

pub(super) fn deny_permission_requests(_webview: &Webview) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub(super) fn edit(_webview: &Webview, _command: super::EditCommand) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}
