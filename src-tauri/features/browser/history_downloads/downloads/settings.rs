use super::*;

pub(in crate::browser) fn browser_download_directory(
    app: &AppHandle,
    agent_download: bool,
) -> Option<PathBuf> {
    if agent_download {
        return app
            .path()
            .app_cache_dir()
            .ok()
            .map(|path| path.join("agent-downloads"));
    }
    dirs::download_dir().filter(|path| path.is_absolute())
}
