//! One crate can't enforce which part depends on which, so this does.
use std::{fs, path::Path};

fn rust_files(folder: &Path, found: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(folder).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn the_sdk_never_depends_on_the_runtime() {
    let mut files = Vec::new();
    rust_files(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src/sdk"), &mut files);
    assert!(!files.is_empty());
    for file in files {
        let text = fs::read_to_string(&file).unwrap();
        assert!(!text.contains("runtime::"), "{} uses the runtime", file.display());
    }
}

#[test]
fn the_crate_knows_nothing_about_tauri() {
    let manifest = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).unwrap();
    assert!(!manifest.to_lowercase().contains("tauri"));
}
