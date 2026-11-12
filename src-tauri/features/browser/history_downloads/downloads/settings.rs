//! Where downloads go: the agent's cache folder, or the person's Downloads folder.
use super::*;

pub(in crate::browser) fn browser_download_directory(
    app: &AppHandle,
    agent_download: bool,
) -> Option<PathBuf> {
    // Agent outputs are task intermediates for verified upload, not user-managed
    // downloads. Keep them in the app's cache rather than requiring macOS access
    // to the user's protected Downloads folder from a WKDownload callback.
    if agent_download {
        return app
            .path()
            .app_cache_dir()
            .ok()
            .map(|path| path.join("agent-downloads"));
    }
    dirs::download_dir().filter(|path| path.is_absolute())
}
