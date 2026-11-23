// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Small helpers: JSON and file IO, path sanitizing, URL encoding and JavaScript-compatible
//! value coercion, kept faithful to the upstream JavaScript.

use file_access::fs;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};

use super::core::*;

pub(super) fn read_text(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub(super) fn read_json(path: &Path) -> Option<Value> {
    read_text(path).and_then(|text| serde_json::from_str(&text).ok())
}

pub(super) fn ensure_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

pub(super) fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub(super) fn write_file_private(path: &Path, contents: &str) -> std::io::Result<()> {
    fs::write(path, contents)?;
    set_private_permissions(path)
}

pub(super) fn write_json(path: &Path, value: &Value) -> SkillResult<()> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let mut text =
        serde_json::to_string_pretty(value).map_err(|e| SkillError::other(e.to_string()))?;
    text.push('\n');
    write_file_private(path, &text).map_err(SkillError::from)
}

pub(super) fn append_line_private(path: &Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path)?;
    file.write_all(line.as_bytes())?;
    set_private_permissions(path)
}

pub(super) fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

pub(super) fn remove_path(path: &Path) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if meta.file_type().is_symlink() {
        if fs::remove_file(path).is_err() {
            let _ = fs::remove_dir(path);
        }
    } else if meta.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

pub(super) fn resolve_lexical(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut out = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

pub(super) fn path_strictly_within(parent: &Path, child: &Path) -> bool {
    match child.strip_prefix(parent) {
        Ok(rest) => !rest.as_os_str().is_empty(),
        Err(_) => false,
    }
}

pub(super) fn remove_empty_ancestors(start_dir: &Path, stop_dir: &Path) {
    let stop = resolve_lexical(stop_dir);
    let mut current = resolve_lexical(start_dir);
    while path_strictly_within(&stop, &current) {
        if fs::remove_dir(&current).is_err() {
            return;
        }
        let Some(parent) = current.parent() else {
            return;
        };
        current = parent.to_path_buf();
    }
}

pub(super) fn copy_dir_recursive(source: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        let meta = fs::metadata(entry.path())?;
        if meta.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

pub(super) fn copy_dir(source: &Path, dest: &Path) -> SkillResult<()> {
    assert_not_nested(source, dest)?;
    remove_path(dest);
    if is_symlink(dest) {
        return Err(SkillError::other(format!(
            "Could not clear symbolic link before copy: {}",
            dest.display()
        )));
    }
    copy_dir_recursive(source, dest).map_err(SkillError::from)
}

pub(super) fn symlink_dir(source: &Path, dest: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    return fs::symlink(source, dest);
    #[cfg(windows)]
    return fs::symlink_dir(source, dest);
    #[cfg(not(any(unix, windows)))]
    unreachable!("unsupported platform")
}

pub(super) fn encode_uri_component(value: &str) -> String {
    const UNRESERVED: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::new();
    for byte in value.as_bytes() {
        if UNRESERVED.contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub(super) fn encode_form_param(value: &str) -> String {
    const KEEP: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._";
    let mut out = String::new();
    for byte in value.as_bytes() {
        if KEEP.contains(byte) {
            out.push(*byte as char);
        } else if *byte == b' ' {
            out.push('+');
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub(super) fn encode_url_path(path: &str) -> String {
    path.split('/')
        .map(encode_uri_component)
        .collect::<Vec<_>>()
        .join("/")
}
pub(super) fn github_raw_url(owner: &str, name: &str, branch: &str, file_path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{owner}/{name}/{branch}/{}",
        encode_url_path(file_path)
    )
}
pub(super) fn github_doc_url(owner: &str, name: &str, branch: &str, file_path: &str) -> String {
    format!(
        "https://github.com/{owner}/{name}/blob/{branch}/{}",
        encode_url_path(file_path)
    )
}

pub(super) fn base64url_no_pad(value: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.as_bytes())
}

pub(super) fn js_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => String::new(),
    }
}

pub(super) fn js_f64(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}

pub(super) fn js_number_or(value: Option<&Value>, default: f64) -> f64 {
    match value {
        None | Some(Value::Null) => default,
        Some(v) => {
            let n = js_f64(v);
            if n == 0.0 || n.is_nan() {
                default
            } else {
                n
            }
        }
    }
}

pub(super) fn json_number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() <= 9.0e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

pub(super) fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

pub(super) fn sanitize_path_segment(value: &str) -> Option<String> {
    let segment = value.trim();
    if segment.is_empty() || segment == "." || segment == ".." {
        return None;
    }
    if segment.contains('/') || segment.contains('\\') || segment.contains('\0') {
        return None;
    }
    Some(segment.to_string())
}

pub(super) fn is_win32_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if bytes[0] == b'/' || bytes[0] == b'\\' {
        return true;
    }
    bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

pub(super) fn sanitize_relative_path(value: &str) -> Option<String> {
    let input = value.trim();
    let raw = input.replace('\\', "/");
    if raw.is_empty() || raw.contains('\0') {
        return None;
    }
    if raw.starts_with('/') || is_win32_absolute(input) || is_win32_absolute(&raw) {
        return None;
    }
    let parts: Vec<&str> = raw.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| *part == "." || *part == ".." || part.contains(':'))
    {
        return None;
    }
    Some(parts.join("/"))
}

pub(super) fn sanitize_local_skill_path(value: &str) -> Option<String> {
    let safe = sanitize_relative_path(value)?;
    if safe.split('/').any(|part| part.starts_with('.')) {
        return None;
    }
    Some(safe)
}

pub(super) fn install_name_from_directory(directory: &str) -> Option<String> {
    let safe = sanitize_relative_path(directory)?;
    safe.rsplit('/').next().and_then(sanitize_path_segment)
}

pub(super) fn target_skill_path(base_dir: &Path, directory: &str) -> Option<PathBuf> {
    let safe = sanitize_relative_path(directory)?;
    let root = resolve_lexical(base_dir);
    let target = resolve_lexical(&root.join(&safe));
    if !path_strictly_within(&root, &target) {
        return None;
    }
    match fs::metadata(&root) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return None,
    }
    let parts: Vec<&str> = safe.split('/').collect();
    let mut current = root.clone();
    for part in &parts[..parts.len() - 1] {
        current = current.join(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => {}
            Ok(_) => return None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return None,
        }
    }
    Some(target)
}

pub(super) fn managed_skill_path(directory: &str) -> SkillResult<PathBuf> {
    target_skill_path(&ssot_dir(), directory)
        .ok_or_else(|| SkillError::other(format!("Invalid skill directory: {directory}")))
}

pub(super) fn assert_not_nested(source: &Path, dest: &Path) -> SkillResult<()> {
    let a = resolve_lexical(source);
    let b = resolve_lexical(dest);
    if a == b {
        return Ok(());
    }
    if path_strictly_within(&a, &b) || path_strictly_within(&b, &a) {
        return Err(SkillError::other(
            "Refusing to sync a skill into its own directory tree",
        ));
    }
    Ok(())
}
