//! Where a website data store lives on disk.

use crate::browser::*;

pub(crate) fn store_data_directory(
    app: &AppHandle,
    store: Option<&str>,
) -> Result<PathBuf, String> {
    data_store_identifier(store)?;
    let home = file_access::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    let path = crate::browser::site_data::profile_store::store_home(&home, store)?;
    #[cfg(target_os = "macos")]
    {
        // WebKit picks the store's folder; `webview` links to it.
        let library = dirs::home_dir()
            .ok_or("The home folder is unavailable.")?
            .join("Library");
        crate::browser::site_data::profile_store::link_store_data(
            &home,
            &library,
            &app.config().identifier,
            store,
        )?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        file_access::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

/// Points a view at its store's data directory. WebView2 needs every view
/// of one directory to create its environment with the same options, so
/// every view of a store is built through here.
pub(crate) fn with_store_data(
    builder: tauri::WebviewBuilder<tauri::Wry>,
    app: &AppHandle,
    store: Option<&str>,
) -> Result<tauri::WebviewBuilder<tauri::Wry>, String> {
    let builder = builder.data_directory(store_data_directory(app, store)?);
    Ok(builder)
}
