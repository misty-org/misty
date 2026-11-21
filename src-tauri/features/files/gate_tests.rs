//! The disk grant opens the whole disk, so only Files may reach it: no `.rs` under
//! `src-tauri/features` outside `file_access/` and `files/` names `file_access::disk`, except
//! `permissions/disk.rs`, which turns the grant on and off. Clippy's `disallowed-methods` holds the
//! rest of the gate the same way.
#![allow(clippy::disallowed_methods)]

use std::path::{Component, Path};

const NEEDLE: &str = concat!("file_access", "::", "disk");

fn allowed(relative: &Path) -> bool {
    let mut parts = relative.components();
    match parts.next() {
        Some(Component::Normal(first)) if first == "file_access" || first == "files" => true,
        _ => relative == Path::new("permissions").join("disk.rs"),
    }
}

#[test]
fn only_files_reaches_the_disk_grant() {
    let features = Path::new(env!("CARGO_MANIFEST_DIR")).join("features");
    let mut offenders = Vec::new();
    let walk = walkdir::WalkDir::new(&features)
        .into_iter()
        .filter_entry(|item| item.file_name() != "target" && item.file_name() != "node_modules");
    for item in walk.filter_map(Result::ok) {
        let path = item.path();
        if !item.file_type().is_file() || path.extension().is_none_or(|ext| ext != "rs") {
            continue;
        }
        let Ok(relative) = path.strip_prefix(&features) else { continue };
        if allowed(relative) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else { continue };
        if text.contains(NEEDLE) {
            offenders.push(relative.display().to_string());
        }
    }
    assert!(
        offenders.is_empty(),
        "only features/files may use the disk grant; found it in: {offenders:?}"
    );
}

#[test]
fn the_allowed_places_are_files_the_gate_and_the_grant_switch() {
    assert!(allowed(Path::new("files/ops.rs")));
    assert!(allowed(Path::new("file_access/disk.rs")));
    assert!(allowed(&Path::new("permissions").join("disk.rs")));
    assert!(!allowed(Path::new("permissions/lib.rs")));
    assert!(!allowed(Path::new("agents/run_control/tool_policy.rs")));
}
