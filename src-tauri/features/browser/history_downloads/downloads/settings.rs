use super::*;

pub(in crate::browser) fn browser_download_directory(
    app: &AppHandle,
    agent_download: bool,
    space_id: &str,
) -> Option<(PathBuf, bool)> {
    if agent_download {
        return app
            .path()
            .app_cache_dir()
            .ok()
            .map(|path| (path.join("agent-downloads"), true));
    }
    if !space_id.is_empty() {
        if let Some(drive) = crate::spaces_drive::run_folder(space_id) {
            return Some((drive.join("Downloads"), true));
        }
    }
    dirs::download_dir()
        .filter(|path| path.is_absolute())
        .map(|path| (path, false))
}
