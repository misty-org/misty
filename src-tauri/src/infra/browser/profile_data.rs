//! Where a profile's website data lives on disk.

use super::*;

pub(in crate::infra) fn browser_data_directory(
    app: &AppHandle,
    profile: Option<&str>,
) -> Result<PathBuf, String> {
    browser_profile_identifier(profile)?;
    let home =
        crate::infra::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    let path = crate::infra::browser_profile::webview_home(&home, profile)?;
    #[cfg(target_os = "macos")]
    {
        // WebKit picks the store's folder; the profile's `webview` links to it.
        let library = dirs::home_dir()
            .ok_or("The home folder is unavailable.")?
            .join("Library");
        crate::infra::browser_profile::link_webview_data(
            &home,
            &library,
            &app.config().identifier,
            profile,
        )?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

/// Points a view at its profile's data directory. WebView2 needs every view
/// of one directory to create its environment with the same options, so
/// extension support is switched on here, for all of them.
pub(in crate::infra) fn with_browser_data(
    builder: tauri::WebviewBuilder<tauri::Wry>,
    app: &AppHandle,
    profile: Option<&str>,
) -> Result<tauri::WebviewBuilder<tauri::Wry>, String> {
    let builder = builder.data_directory(browser_data_directory(app, profile)?);
    #[cfg(windows)]
    let builder = builder.browser_extensions_enabled(true);
    Ok(builder)
}
