// The composer's "Capture part of the screen": the person drags a rectangle with the system's
// own picker, and the picture comes back as an attachment. Nothing is taken without that drag.

use base64::Engine as _;
use serde_json::{json, Value};

/// A PNG's size, from its header.
fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

/// Runs the system's region picker. `None` when the person cancelled it.
#[tauri::command]
pub async fn misty_capture_region(window: tauri::Webview) -> Result<Option<Value>, String> {
    super::trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        let file = std::env::temp_dir().join(format!("misty-region-{}.png", uuid::Uuid::new_v4()));
        let status = tokio::process::Command::new("/usr/sbin/screencapture")
            .args(["-i", "-x", "-t", "png"])
            .arg(&file)
            .status()
            .await
            .map_err(|error| format!("Misty couldn't open the screen picker: {error}"))?;
        let bytes = match tokio::fs::read(&file).await {
            Ok(bytes) => bytes,
            // Escape leaves no file: nothing was chosen.
            Err(_) if status.success() || !file.exists() => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let _ = tokio::fs::remove_file(&file).await;
        let (width, height) = png_size(&bytes).ok_or("The capture wasn't a picture.")?;
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(Some(json!({
            "dataUrl": format!("data:image/png;base64,{data}"),
            "width": width,
            "height": height,
        })))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Capturing part of the screen works on macOS for now.".into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_png_size() {
        let mut header = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        header.extend(640u32.to_be_bytes());
        header.extend(480u32.to_be_bytes());
        assert_eq!(super::png_size(&header), Some((640, 480)));
        assert_eq!(super::png_size(b"nope"), None);
    }
}
