use super::{PageFacts, Reply, StoreScope};
use tauri::Webview;

const UNSUPPORTED: &str = "This platform's browser engine is not supported.";

pub(super) fn install_media_permissions(_webview: &Webview) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub(super) fn page_facts(
    _webview: &Webview,
    _reply: Reply<Result<PageFacts, String>>,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub(super) fn stop_capture(
    _webview: &Webview,
    _store: Option<StoreScope>,
    _camera: bool,
    _microphone: bool,
    _reply: Reply<()>,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub(super) fn edit(_webview: &Webview, _command: super::EditCommand) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}
