// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/images.rs.
use base64::Engine as _;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
const MAX_PASTED_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const PASTED_IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

pub(crate) fn pasted_images_dir() -> PathBuf {
    crate::engines::support::paths::app_home().join("pasted-images")
}

fn base64_fits_limit(clean_len: usize) -> bool {
    clean_len <= MAX_PASTED_IMAGE_BYTES / 3 * 4 + 8
}

fn store_image_bytes(bytes: &[u8], ext: &str) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("empty image payload".to_string());
    }
    if bytes.len() > MAX_PASTED_IMAGE_BYTES {
        return Err("pasted image exceeds 8MB".to_string());
    }
    let dir = pasted_images_dir();
    file_access::fs::create_dir_all(&dir).map_err(|e| format!("create pasted image dir: {e}"))?;
    let path = dir.join(format!("paste-{}.{}", uuid::Uuid::new_v4(), ext));
    file_access::fs::write(&path, bytes).map_err(|e| format!("write pasted image: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_pasted_image(data_base64: String, extension: String) -> Result<String, String> {
    let ext = extension.trim().to_ascii_lowercase();
    if !PASTED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("unsupported image extension: {ext}"));
    }
    let clean: String = data_base64.chars().filter(|c| !c.is_whitespace()).collect();
    if !base64_fits_limit(clean.len()) {
        return Err("pasted image exceeds 8MB".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean.as_bytes())
        .map_err(|_| "invalid base64 payload".to_string())?;
    store_image_bytes(&bytes, &ext)
}

pub fn sweep_pasted_images() {
    let dir = pasted_images_dir();
    if let Ok(entries) = file_access::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let _ = file_access::fs::remove_file(entry.path());
        }
    }
}

pub(crate) fn absolutize_image_path(raw: &str, workspace: &Path) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return None;
    }
    let path = PathBuf::from(trimmed.trim_start_matches("file://"));
    Some(if path.is_absolute() {
        path
    } else {
        workspace.join(path)
    })
}

pub fn load_image(raw: &str, workspace: &Path) -> Result<(String, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty image reference".to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("data:") {
        let (meta, payload) = rest
            .split_once(',')
            .ok_or_else(|| "malformed data url".to_string())?;
        let mime = meta.strip_suffix(";base64").unwrap_or("image/png");
        let clean: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
        if clean.is_empty() {
            return Err("empty data url payload".to_string());
        }
        if !base64_fits_limit(clean.len()) {
            return Err("image data url exceeds 8MB".to_string());
        }
        base64::engine::general_purpose::STANDARD
            .decode(clean.as_bytes())
            .map_err(|_| "invalid base64 payload".to_string())?;
        return Ok((mime.to_string(), clean));
    }
    let Some(path) = absolutize_image_path(trimmed, workspace) else {
        return Err("empty image reference".to_string());
    };
    let resolved = crate::engines::support::files::canonicalize_lenient(&path)?;
    let workspace_ok = crate::engines::support::files::canonicalize_lenient(workspace)
        .map(|root| resolved.starts_with(root))
        .unwrap_or(false);
    let pasted_ok = crate::engines::support::files::canonicalize_lenient(&pasted_images_dir())
        .map(|root| resolved.starts_with(root))
        .unwrap_or(false);
    if !workspace_ok && !pasted_ok {
        return Err(format!(
            "image is outside the workspace and pasted-images sandbox: {}",
            path.display()
        ));
    }
    let bytes = read_image_file(&resolved)?;
    let mime = match resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };
    Ok((
        mime.to_string(),
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads an image the person attached from their project folder, which may not be linked"
)]
fn read_image_file(resolved: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(resolved)
        .map_err(|e| format!("stat image {}: {e}", resolved.display()))?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err(format!("image {} exceeds 8MB", resolved.display()));
    }
    std::fs::read(resolved).map_err(|e| format!("read image {}: {e}", resolved.display()))
}

pub fn claude_stdin_message(
    prompt: &str,
    images: &[String],
    workspace: &Path,
) -> Result<String, String> {
    let mut content: Vec<Value> = Vec::new();
    for raw in images {
        let (mime, data) = load_image(raw, workspace)?;
        content.push(json!({
            "type": "image",
            "source": { "type": "base64", "media_type": mime, "data": data }
        }));
    }
    if !prompt.trim().is_empty() {
        content.push(json!({ "type": "text", "text": prompt }));
    }
    let message = json!({
        "type": "user",
        "message": { "role": "user", "content": content }
    });
    serde_json::to_string(&message).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    #[test]
    fn round_trips_png_to_pasted_images_dir() {
        let path = save_pasted_image(PNG_B64.to_string(), "png".to_string()).unwrap();
        let written = std::fs::read(&path).unwrap();
        assert_eq!(
            written,
            base64::engine::general_purpose::STANDARD
                .decode(PNG_B64)
                .unwrap()
        );
        assert!(path.contains("pasted-images"));
        assert!(path.ends_with(".png"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_unknown_extension() {
        assert!(save_pasted_image(PNG_B64.to_string(), "exe".to_string()).is_err());
    }

    #[test]
    fn rejects_garbage_base64_and_empty_payload() {
        assert!(save_pasted_image("!!!not-base64!!!".to_string(), "png".to_string()).is_err());
        assert!(save_pasted_image(String::new(), "png".to_string()).is_err());
    }
}
