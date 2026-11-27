use std::path::{Path, PathBuf};

use base64::Engine as _;
use file_access::fs;
use serde::Serialize;
use tauri::Webview;

use crate::project::person_window;

const MOST_FILES: usize = 20;
const MOST_BYTES: u64 = 128 << 20;

#[derive(Serialize)]
pub struct AgentFile {
    name: String,
    data: String,
}

fn inside(folder: &Path, asked: &str) -> Result<PathBuf, String> {
    let asked = asked.trim();
    if asked.is_empty() {
        return Err("Name a file in your working folder.".into());
    }
    let joined = if Path::new(asked).is_absolute() {
        PathBuf::from(asked)
    } else {
        folder.join(asked)
    };
    let found = fs::canonicalize(&joined)
        .map_err(|_| format!("{asked} isn't in your working folder. Save it there first."))?;
    if !found.starts_with(folder) {
        return Err(format!(
            "{asked} is outside your working folder. Copy it into the folder first, then pass that path."
        ));
    }
    let meta = fs::metadata(&found).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err(format!("{asked} isn't a file."));
    }
    Ok(found)
}

pub(crate) fn read(run_id: &str, paths: &[String]) -> Result<Vec<AgentFile>, String> {
    if paths.is_empty() {
        return Err("Name at least one file.".into());
    }
    if paths.len() > MOST_FILES {
        return Err(format!("Hand over at most {MOST_FILES} files at once."));
    }
    let folder = crate::engines::runs::folder_of(run_id)
        .ok_or("Your files come from your working folder, and this run has none.")?;
    let folder = fs::canonicalize(&folder)
        .map_err(|_| "Misty can't open your working folder.".to_string())?;
    let found = paths
        .iter()
        .map(|asked| inside(&folder, asked))
        .collect::<Result<Vec<_>, _>>()?;
    let total: u64 = found
        .iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|meta| meta.len())
        .sum();
    if total > MOST_BYTES {
        return Err("Those files are too large to hand to an app at once (128 MB in all).".into());
    }
    found
        .iter()
        .map(|path| {
            let bytes = fs::read(path).map_err(|error| error.to_string())?;
            Ok(AgentFile {
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "file".into()),
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn space_app_agent_files(
    webview: Webview,
    run_id: String,
    paths: Vec<String>,
) -> Result<Vec<AgentFile>, String> {
    person_window(&webview)?;
    tauri::async_runtime::spawn_blocking(move || read(&run_id, &paths))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn save(run_id: &str, asked: &str, bytes: &[u8]) -> Result<String, String> {
    let asked = asked.trim().trim_start_matches("./");
    let relative = Path::new(asked);
    if asked.is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("Name the file by a path inside your working folder, such as page.pdf.".into());
    }
    let folder = crate::engines::runs::folder_of(run_id)
        .ok_or("Files are saved into your working folder, and this run has none.")?;
    let folder = fs::canonicalize(&folder)
        .map_err(|_| "Misty can't open your working folder.".to_string())?;
    let wanted = folder.join(relative);
    let parent = wanted.parent().unwrap_or(&folder).to_path_buf();
    fs::create_dir_all(&parent).map_err(|error| error.to_string())?;
    let parent = fs::canonicalize(&parent).map_err(|error| error.to_string())?;
    if !parent.starts_with(&folder) {
        return Err(format!("{asked} is outside your working folder."));
    }
    let stem = wanted
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "page".into());
    let extension = wanted
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();
    let mut path = parent.join(format!("{stem}{extension}"));
    let mut copy = 2;
    while fs::metadata(&path).is_ok() {
        path = parent.join(format!("{stem} {copy}{extension}"));
        copy += 1;
    }
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path
        .strip_prefix(&folder)
        .unwrap_or(&path)
        .to_string_lossy()
        .into_owned())
}
