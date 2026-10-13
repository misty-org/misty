//! Project snapshots: a ZIP of a code project after an agent changed it, so
//! the agent's Space keeps a copy of what it built. The folder stays local;
//! only the snapshot is uploaded, by the app, to the agent's Space.

use std::{
    io::Write,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};
use tauri::State;

use crate::{
    app::runtime::MistyRuntime,
    error::{ApiError, ApiResult},
};

/// Snapshots stop here; Space uploads from the app are capped at 128 MB.
const MAX_SNAPSHOT_BYTES: u64 = 100 * 1024 * 1024;

/// Folders that are rebuilt, private or huge, and never part of a snapshot.
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
    ) || name.starts_with(".env")
}

/// Zips a project into Misty's cache and returns where. A page never names
/// the folder: it comes from the shared project.
#[tauri::command]
pub async fn code_project_snapshot(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    run_id: String,
) -> ApiResult<Value> {
    if webview.label() != "main" {
        return Err(ApiError::Message(
            "Only Misty's main window can use code projects.".into(),
        ));
    }
    let project = state.agents.project(scope_id).await?;
    let directory = crate::infra::paths::misty_home_dir()
        .ok_or_else(|| ApiError::Message("Misty's data folder isn't available.".into()))?
        .join(".cache")
        .join("agent-snapshots");
    tokio::task::spawn_blocking(move || write_snapshot(&project.root, &directory, &run_id))
        .await
        .map_err(|_| ApiError::Message("The snapshot stopped unexpectedly.".into()))?
        .map_err(ApiError::Message)
}

fn write_snapshot(root: &Path, directory: &Path, run_id: &str) -> Result<Value, String> {
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let project = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".into());
    let stamp = chrono_like_stamp();
    let run: String = run_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let name = format!(
        "{project} {stamp}{}.zip",
        if run.is_empty() {
            String::new()
        } else {
            format!(" {run}")
        }
    );
    let path: PathBuf = directory.join(&name);
    let file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut read = 0u64;
    let mut files = 0u64;
    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !skipped(&entry.file_name().to_string_lossy()));
    for entry in walker {
        let entry = entry.map_err(|error| error.to_string())?;
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| error.to_string())?;
        let name = relative.to_string_lossy().replace('\\', "/");
        if name.is_empty() || !entry.file_type().is_file() {
            continue;
        }
        read += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if read > MAX_SNAPSHOT_BYTES {
            drop(writer);
            let _ = std::fs::remove_file(&path);
            return Err("This project is over 100 MB without its build and package folders, so no snapshot was saved.".into());
        }
        let bytes = std::fs::read(entry.path()).map_err(|error| error.to_string())?;
        writer
            .start_file(name, options)
            .map_err(|error| error.to_string())?;
        writer
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
        files += 1;
    }
    writer.finish().map_err(|error| error.to_string())?;
    Ok(json!({ "path": path.to_string_lossy(), "name": name, "files": files }))
}

/// "2026-10-12 1430" in UTC, without pulling in a date crate.
fn chrono_like_stamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let minutes = seconds.rem_euclid(86_400) / 60;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02} {:02}{:02}",
        minutes / 60,
        minutes % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_leave_out_git_packages_and_secrets() {
        let source = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("index.html"), "<h1>Bakery</h1>").unwrap();
        std::fs::write(source.path().join(".env.local"), "SECRET=1").unwrap();
        std::fs::create_dir_all(source.path().join(".git")).unwrap();
        std::fs::write(source.path().join(".git/config"), "[core]").unwrap();
        std::fs::create_dir_all(source.path().join("node_modules/pkg")).unwrap();
        std::fs::write(source.path().join("node_modules/pkg/index.js"), "x").unwrap();
        let out = tempfile::tempdir().unwrap();
        let result = write_snapshot(source.path(), out.path(), "run_123").unwrap();
        let archive =
            zip::ZipArchive::new(std::fs::File::open(result["path"].as_str().unwrap()).unwrap())
                .unwrap();
        let names: Vec<String> = archive.file_names().map(str::to_owned).collect();
        assert_eq!(names, vec!["index.html".to_owned()]);
    }
}
