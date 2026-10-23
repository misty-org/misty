//! Reading and saving the bookmarks HTML file every browser reads.
use super::*;

/// Reads a bookmarks HTML file the person picks. `None` when they cancel.
#[tauri::command]
pub async fn browser_import_bookmarks_file(
    app: AppHandle,
) -> Result<Option<ImportedBookmarks>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a bookmarks file")
        .add_filter("Bookmarks", &["html", "htm"])
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "Choose a file on this computer.".to_owned())?;
    blocking(move || {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size > 64 << 20 {
            return Err("That file is too large to be a bookmarks file.".to_owned());
        }
        let bytes = std::fs::read(&path).map_err(|_| "That file could not be read.".to_owned())?;
        let (roots, skipped) = netscape::parse(&String::from_utf8_lossy(&bytes))?;
        Ok(Some(ImportedBookmarks { roots, skipped }))
    })
    .await
}

/// Saves Misty's bookmarks as the HTML file every browser imports. Returns
/// whether a file was written (`false` when the person cancels).
#[tauri::command]
pub async fn browser_import_save_bookmarks(
    app: AppHandle,
    roots: BookmarkRoots,
) -> Result<bool, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let name = format!("bookmarks_{}.html", chrono::Local::now().format("%Y-%m-%d"));
    app.dialog()
        .file()
        .set_title("Export bookmarks")
        .set_file_name(&name)
        .add_filter("Bookmarks", &["html"])
        .save_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(false);
    };
    let path = file
        .into_path()
        .map_err(|_| "Choose a location on this computer.".to_owned())?;
    std::fs::write(path, netscape::write(&roots))
        .map_err(|_| "The bookmarks file could not be saved there.".to_owned())?;
    Ok(true)
}
