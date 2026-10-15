//! Project snapshots: a ZIP of a project after a delegated coding run changed
//! it, so the agent's Space keeps a copy of what it built. The folder stays on
//! this computer; the app uploads only the snapshot.
use std::{
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;

/// Snapshots stop here; Space uploads from the app are capped at 128 MB.
const MAX_SNAPSHOT_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub path: String,
    pub name: String,
    pub files: u64,
}

/// Folders and files that are rebuilt, private or huge, never in a snapshot.
fn skipped(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".next"
            | ".cache"
            | ".DS_Store"
            | ".misty"
    ) || name.starts_with(".env")
}

/// Zips a project into `directory` and returns where.
pub fn write_snapshot(root: &Path, directory: &Path, run_id: &str) -> Result<Snapshot, String> {
    let failed = |_| "The snapshot couldn't be written.".to_owned();
    std::fs::create_dir_all(directory).map_err(failed)?;
    let project = root.file_name().map_or_else(
        || "project".into(),
        |name| name.to_string_lossy().into_owned(),
    );
    let stamp = chrono::Utc::now().format("%Y-%m-%d %H%M");
    let run: String = run_id
        .chars()
        .rev()
        .filter(char::is_ascii_alphanumeric)
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let name = format!("{project} {stamp} {run}.zip");
    let path: PathBuf = directory.join(&name);
    let file = std::fs::File::create(&path).map_err(failed)?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let (mut read, mut files) = (0u64, 0u64);
    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !skipped(&entry.file_name().to_string_lossy()));
    for entry in walker.flatten() {
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let entry_name = relative.to_string_lossy().replace('\\', "/");
        if entry_name.is_empty() || !entry.file_type().is_file() {
            continue;
        }
        read += entry.metadata().map_or(0, |meta| meta.len());
        if read > MAX_SNAPSHOT_BYTES {
            drop(writer);
            let _ = std::fs::remove_file(&path);
            return Err("This project is over 100 MB without its build and package folders, so no snapshot was saved.".into());
        }
        let bytes = std::fs::read(entry.path()).map_err(failed)?;
        writer
            .start_file(entry_name, options)
            .map_err(|_| "The snapshot couldn't be written.".to_owned())?;
        writer.write_all(&bytes).map_err(failed)?;
        files += 1;
    }
    writer
        .finish()
        .map_err(|_| "The snapshot couldn't be written.".to_owned())?;
    Ok(Snapshot {
        path: path.to_string_lossy().into_owned(),
        name,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_leave_out_secrets_and_rebuildable_folders() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        for (file, text) in [
            ("index.html", "hi"),
            ("src/app.js", "x"),
            (".env.local", "SECRET=1"),
            ("node_modules/a/i.js", "dep"),
            (".git/HEAD", "ref"),
        ] {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        let out = tempfile::tempdir().unwrap();
        let snapshot = write_snapshot(root, out.path(), "invocation_1234abcd").unwrap();
        assert_eq!(snapshot.files, 2);
        assert!(
            snapshot.name.ends_with(" 1234abcd.zip"),
            "{}",
            snapshot.name
        );
        let mut archive =
            zip::ZipArchive::new(std::fs::File::open(&snapshot.path).unwrap()).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["index.html", "src/app.js"]);
    }
}
