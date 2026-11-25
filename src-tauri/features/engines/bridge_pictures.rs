use base64::Engine as _;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MOST: usize = 4;
const MOST_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn pictures_dir() -> PathBuf {
    crate::engines::support::paths::app_home().join("step-pictures")
}

pub(super) fn allow_pictures(app: &AppHandle) {
    let dir = pictures_dir();
    if file_access::fs::create_dir_all(&dir).is_ok() {
        let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    }
}

pub(super) fn step_pictures(run_id: &str, tool_id: &str, result: &Value) -> Vec<String> {
    let mut found = Vec::new();
    collect(result, &mut found);
    found
        .into_iter()
        .enumerate()
        .filter_map(|(index, (mime, data))| save(run_id, tool_id, index, mime, data))
        .collect()
}

fn collect<'a>(value: &'a Value, found: &mut Vec<(&'a str, &'a str)>) {
    if found.len() >= MOST {
        return;
    }
    match value {
        Value::Array(items) => items.iter().for_each(|item| collect(item, found)),
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("image") {
                let source = map.get("source").unwrap_or(value);
                let mime = source
                    .get("media_type")
                    .or_else(|| source.get("mimeType"))
                    .and_then(Value::as_str);
                if let (Some(mime), Some(data)) = (mime, source.get("data").and_then(Value::as_str)) {
                    found.push((mime, data));
                }
                return;
            }
            map.values().for_each(|item| collect(item, found));
        }
        _ => {}
    }
}

fn save(run_id: &str, tool_id: &str, index: usize, mime: &str, data: &str) -> Option<String> {
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => return None,
    };
    let clean: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.len() > MOST_BYTES / 3 * 4 + 8 {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(clean).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let dir = pictures_dir().join(plain(run_id));
    file_access::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{}-{index}.{ext}", plain(tool_id)));
    file_access::fs::write(&path, &bytes).ok()?;
    Some(path.to_string_lossy().to_string())
}

fn plain(text: &str) -> String {
    text.chars()
        .take(80)
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_pictures_in_either_shape_and_stops_at_four() {
        let claude = json!({ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "aGk=" } });
        let mcp = json!({ "type": "image", "mimeType": "image/jpeg", "data": "aGk=" });
        let result = json!([claude, { "content": [mcp, mcp, mcp, mcp] }, { "type": "text", "text": "done" }]);
        let mut found = Vec::new();
        collect(&result, &mut found);
        assert_eq!(found.len(), 4);
        assert_eq!(found[0], ("image/png", "aGk="));
        assert_eq!(found[1], ("image/jpeg", "aGk="));
    }

    #[test]
    fn names_stay_inside_the_folder() {
        assert_eq!(plain("../run/1"), "___run_1");
    }
}
