use super::*;

pub(super) fn display_path(path: &Path) -> String {
    clean_display_path(path.to_string_lossy().as_ref())
}

#[cfg(windows)]
fn clean_display_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

#[cfg(not(windows))]
fn clean_display_path(path: &str) -> String {
    path.to_string()
}

pub(super) fn sanitize_drag_file_name(name: &str) -> String {
    let mut sanitized = String::with_capacity(name.len());
    for character in name.chars() {
        if matches!(character, '/' | '\\' | ':' | '\0') || character.is_control() {
            sanitized.push('_');
        } else {
            sanitized.push(character);
        }
    }
    let trimmed = sanitized.trim_matches([' ', '.']).trim();
    if trimmed.is_empty() {
        "item".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn cleanup_expired_drag_stage_dirs(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64;
    let ttl_ms = ClipboardCache::DEFAULT_TTL_HOURS * 60 * 60 * 1000;

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
            .unwrap_or_default();
        if drag_stage_entry_expired(modified_ms, now_ms, ttl_ms) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

pub(super) fn drag_stage_entry_expired(modified_ms: i64, now_ms: i64, ttl_ms: i64) -> bool {
    modified_ms <= 0 || now_ms.saturating_sub(modified_ms) > ttl_ms
}
