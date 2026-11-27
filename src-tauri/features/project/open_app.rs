// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! "Open in": a linked folder (or a file in it) in the person's editor — VS Code, Cursor, a
//! JetBrains IDE, Zed, Sublime Text, Xcode — or in Finder, a program the person added, or an
//! HTML file in their browser. Every path is checked against the account's linked folders.
//!
//! Only programs on a fixed list are started by name. A program the person adds is picked in
//! the system's own file dialog and kept natively, in a `misty.db` row windows can't read or
//! write; a window then names it by id, never by path.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::{linked_path, person_window};
use crate::app::runtime::MistyRuntime;

mod browser;
mod custom;
mod presets;
mod program_icon;
#[cfg(test)]
mod tests;

use custom::*;
pub use custom::{CustomProgram, CustomRequest, CustomResult};
use presets::*;

#[cfg(target_os = "macos")]
fn format_exit_detail(code: Option<i32>) -> String {
    code.map(|value| format!("exit code {value}"))
        .unwrap_or_else(|| "it was stopped".to_string())
}

async fn linked(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    path: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    linked_path(app, account, path).await
}

fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

#[tauri::command]
pub async fn project_open_in(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
    target: String,
) -> Result<(), String> {
    let path = plain_path(&linked(&app, &webview, &account, &path).await?);
    let preset = preset(&target).ok_or("That app isn't one Misty opens.")?;
    open_with_preset(preset, &path).await
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn project_open_custom(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    request: CustomRequest,
) -> Result<CustomResult, String> {
    person_window(&webview)?;
    let store = app.state::<MistyRuntime>().environment.store();
    match request {
        CustomRequest::List => {
            let programs = blocking(move || read_programs(&store)).await?.programs;
            Ok(CustomResult {
                programs,
                added: None,
            })
        }
        CustomRequest::Add => {
            let Some(path) = pick_program(&webview).await? else {
                let programs = blocking(move || read_programs(&store)).await?.programs;
                return Ok(CustomResult {
                    programs,
                    added: None,
                });
            };
            let name = program_name(&path);
            let added = CustomProgram {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                path: path.to_string_lossy().into_owned(),
            };
            let kept = added.clone();
            let programs = blocking(move || {
                let mut saved = read_programs(&store)?;
                saved.programs.retain(|program| program.path != kept.path);
                saved.programs.push(kept);
                write_programs(&store, &saved)?;
                Ok(saved.programs)
            })
            .await?;
            let added = programs.iter().find(|p| p.path == added.path).cloned();
            Ok(CustomResult { programs, added })
        }
        CustomRequest::Remove { id } => {
            let programs = blocking(move || {
                let mut saved = read_programs(&store)?;
                saved.programs.retain(|program| program.id != id);
                write_programs(&store, &saved)?;
                Ok(saved.programs)
            })
            .await?;
            Ok(CustomResult {
                programs,
                added: None,
            })
        }
        CustomRequest::Open { id, path } => {
            let target = plain_path(&linked_path(&app, &account, &path).await?);
            let saved = blocking(move || read_programs(&store)).await?;
            let program = saved
                .programs
                .iter()
                .find(|program| program.id == id)
                .cloned()
                .ok_or("That program was removed.")?;
            open_custom(Path::new(&program.path), &target, &program.name).await?;
            Ok(CustomResult {
                programs: saved.programs,
                added: None,
            })
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramIcon {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[tauri::command]
pub async fn project_program_icon(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    target: String,
) -> Result<ProgramIcon, String> {
    person_window(&webview)?;
    if let Some(id) = target.strip_prefix("custom:") {
        let store = app.state::<MistyRuntime>().environment.store();
        let id = id.to_string();
        return blocking(move || {
            let saved = read_programs(&store)?;
            let Some(program) = saved.programs.iter().find(|program| program.id == id) else {
                return Ok(ProgramIcon {
                    installed: false,
                    icon: None,
                });
            };
            let path = PathBuf::from(&program.path);
            Ok(ProgramIcon {
                installed: file_access::fs::exists(&path),
                icon: program_icon::icon_data_url(&path),
            })
        })
        .await;
    }
    let preset = preset(&target).ok_or("That app isn't one Misty opens.")?;
    blocking(move || Ok(preset_icon(preset))).await
}

#[cfg(target_os = "macos")]
fn preset_icon(preset: &Preset) -> ProgramIcon {
    let bundle = bundle_path(preset);
    ProgramIcon {
        installed: bundle.is_some(),
        icon: bundle.as_deref().and_then(program_icon::icon_data_url),
    }
}

#[cfg(not(target_os = "macos"))]
fn preset_icon(preset: &Preset) -> ProgramIcon {
    if preset.id == "finder" {
        return ProgramIcon {
            installed: true,
            icon: None,
        };
    }
    let program = program_candidates(preset).into_iter().next();
    ProgramIcon {
        installed: program.is_some(),
        icon: program.as_deref().and_then(program_icon::icon_data_url),
    }
}

#[cfg(windows)]
fn explorer_select_arg(path: &str) -> String {
    format!("/select,\"{path}\"")
}

async fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = tokio::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(path)
            .stdin(Stdio::null())
            .status()
            .await
            .map_err(|error| format!("Finder could not be opened: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "Finder could not be opened ({}).",
                format_exit_detail(status.code())
            ))
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(explorer_select_arg(&path.to_string_lossy()))
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Explorer could not be opened: {error}"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        tauri_plugin_opener::reveal_item_in_dir(path)
            .map_err(|error| format!("The file manager could not be opened: {error}"))
    }
}

#[tauri::command]
pub async fn project_reveal(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<(), String> {
    let path = plain_path(&linked(&app, &webview, &account, &path).await?);
    reveal(&path).await
}

#[tauri::command]
pub async fn project_open_in_browser(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<(), String> {
    let path = plain_path(&linked(&app, &webview, &account, &path).await?);
    browser::open_in_browser(&path).await
}
