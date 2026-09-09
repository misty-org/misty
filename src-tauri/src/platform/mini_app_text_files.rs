//! Text access uses a live registration's opaque file grants, never caller paths.
use super::PermissionSet;
use serde_json::{json, Value};
use std::io::{Read, Seek, SeekFrom, Write};

// Keep aligned with MISTY_TEXT_FILE_MAX_BYTES in @misty/contracts and Code's editor.
const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;

pub(super) fn execute(
    permissions: &PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let handle = params
        .get("handle")
        .and_then(Value::as_str)
        .ok_or("Missing file handle.")?;
    let granted = permissions
        .files
        .get(handle)
        .ok_or("This file is not granted to this App.")?;
    match method {
        "files.readText" => {
            let mut file = granted.file.try_clone().map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            file.take((MAX_TEXT_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            // Check size before decoding: the bounded read may split a UTF-8 character.
            if bytes.len() > MAX_TEXT_BYTES {
                return Err("Text files are limited to 5 MiB per request.".into());
            }
            let text = String::from_utf8(bytes).map_err(|_| "The file is not UTF-8 text.")?;
            Ok(json!({ "text": text }))
        }
        "files.writeText" => {
            if !granted.writable {
                return Err(
                    "This file was selected for reading. Choose it for writing first.".into(),
                );
            }
            let text = params
                .get("text")
                .and_then(Value::as_str)
                .ok_or("Missing text.")?;
            if text.len() > MAX_TEXT_BYTES {
                return Err("Text files are limited to 5 MiB per request.".into());
            }
            // Validate everything before truncation. This is an in-place write to the
            // granted file descriptor, not an atomic path replacement or conflict check.
            let mut file = granted.file.try_clone().map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            file.set_len(0).map_err(|e| e.to_string())?;
            file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("Unknown text file operation.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::FileGrant;

    fn fixture(writable: bool) -> PermissionSet {
        let mut permissions = PermissionSet::from_document(
            "code",
            &json!({"runtime_capabilities": ["files.read", "files.write"]}),
            None,
        )
        .unwrap();
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(b"original contents").unwrap();
        permissions
            .files
            .insert("owned".into(), FileGrant { file, writable });
        permissions
    }
    fn read(permissions: &PermissionSet) -> Result<Value, String> {
        execute(permissions, "files.readText", &json!({"handle": "owned"}))
    }
    fn write(permissions: &PermissionSet, text: &str) -> Result<Value, String> {
        execute(
            permissions,
            "files.writeText",
            &json!({"handle": "owned", "text": text}),
        )
    }

    #[test]
    fn supports_five_mib_utf8_and_truncates_shorter_replacements() {
        let permissions = fixture(true);
        let text = "🦀".repeat(MAX_TEXT_BYTES / 4);
        write(&permissions, &text).unwrap();
        assert_eq!(read(&permissions).unwrap()["text"], text);
        write(&permissions, "short").unwrap();
        assert_eq!(read(&permissions).unwrap()["text"], "short");
        write(&permissions, "").unwrap();
        assert_eq!(read(&permissions).unwrap()["text"], "");
    }

    #[test]
    fn invalid_writes_preserve_existing_file_contents() {
        let permissions = fixture(true);
        let oversized = "🦀".repeat(MAX_TEXT_BYTES / 4 + 1);
        assert!(write(&permissions, &oversized)
            .unwrap_err()
            .contains("5 MiB"));
        assert!(execute(
            &permissions,
            "files.writeText",
            &json!({"handle":"owned", "text":42})
        )
        .is_err());
        assert_eq!(read(&permissions).unwrap()["text"], "original contents");
        let readonly = fixture(false);
        assert!(write(&readonly, "changed").is_err());
        assert_eq!(read(&readonly).unwrap()["text"], "original contents");
    }

    #[test]
    fn rejects_foreign_released_and_revoked_handles() {
        let mut permissions = fixture(true);
        for method in ["files.readText", "files.writeText"] {
            assert!(execute(
                &permissions,
                method,
                &json!({"handle":"foreign", "text":"x"})
            )
            .is_err());
        }
        super::super::binary_files::release(&mut permissions, "owned");
        assert!(read(&permissions).is_err());
        assert!(write(&permissions, "x").is_err());
        let mut permissions = fixture(true);
        permissions.decide("files.read", true).unwrap();
        permissions.decide("files.read", false).unwrap();
        assert!(read(&permissions).is_err());
        assert!(write(&permissions, "x").is_err());
    }

    #[test]
    fn bounded_reads_reject_oversized_and_non_utf8_files() {
        let permissions = fixture(true);
        let mut file = permissions.files["owned"].file.try_clone().unwrap();
        file.set_len((MAX_TEXT_BYTES + 1) as u64).unwrap();
        assert!(read(&permissions).unwrap_err().contains("5 MiB"));
        file.set_len(0).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        file.write_all(&[0xff, 0xfe]).unwrap();
        assert!(read(&permissions).unwrap_err().contains("UTF-8"));
    }
}
