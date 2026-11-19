//! Media work done on this computer for the photo editor. Cutting a photo's subject out of its
//! background: Apple's Vision finds the subject (macOS 14 and later) and Core Image writes it
//! alone, over transparency, as a PNG. Nothing leaves the computer. Elsewhere it isn't offered.

#[cfg(target_os = "macos")]
mod cutout_macos;
pub mod classify;
#[cfg(target_os = "macos")]
mod classify_macos;

/// The largest photo sent to be cut out: a 64-megapixel PNG, with room to spare.
const MAX_CUTOUT_BYTES: usize = 512 * 1024 * 1024;

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

/// Whether this computer can cut a photo's subject out, so the editor shows the tool only there.
#[tauri::command]
pub fn image_cutout_supported() -> bool {
    #[cfg(target_os = "macos")]
    return cutout_macos::supported();
    #[cfg(not(target_os = "macos"))]
    false
}

/// The photo sent as the body (PNG or JPEG bytes), with only its subject left, as a PNG.
#[tauri::command]
pub async fn image_cutout(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    person_window(&webview)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The image didn't arrive.".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_CUTOUT_BYTES {
        return Err("That image is too large to cut out.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let bytes = bytes.clone();
        let png = tokio::task::spawn_blocking(move || cutout_macos::cut_out(&bytes))
            .await
            .map_err(|error| error.to_string())??;
        Ok(tauri::ipc::Response::new(png))
    }
    #[cfg(not(target_os = "macos"))]
    Err("Removing a background needs macOS 14 or later.".into())
}
