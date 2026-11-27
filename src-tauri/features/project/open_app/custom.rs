// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Programs the person added to "Open in", kept natively and opened by id.

use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomProgram {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct Programs {
    #[serde(default)]
    pub(super) programs: Vec<CustomProgram>,
}

pub(super) const PROGRAMS_SCOPE: &str = "grant:open-in-programs";

pub(super) fn read_programs(store: &database::store::Store) -> Result<Programs, String> {
    use rusqlite::OptionalExtension;
    let connection = store.connect().map_err(|error| error.to_string())?;
    let row: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [PROGRAMS_SCOPE],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(row
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

pub(super) fn write_programs(
    store: &database::store::Store,
    programs: &Programs,
) -> Result<(), String> {
    let text = serde_json::to_string(programs).map_err(|error| error.to_string())?;
    store
        .connect()
        .map_err(|error| error.to_string())?
        .execute(
            "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
             ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
            rusqlite::params![PROGRAMS_SCOPE, text],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CustomRequest {
    List,
    Add,
    Remove { id: String },
    Open { id: String, path: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomResult {
    pub programs: Vec<CustomProgram>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<CustomProgram>,
}
pub(super) async fn pick_program(webview: &tauri::Webview) -> Result<Option<PathBuf>, String> {
    let pick = crate::files::pick::Pick::program("Choose a program to open folders in");
    #[cfg(windows)]
    let pick = pick.accept(&["exe"]);
    crate::files::pick::pick_one(webview, pick).await
}

pub(super) fn program_name(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

pub(super) async fn open_custom(program: &Path, target: &Path, name: &str) -> Result<(), String> {
    let program = file_access::fs::canonicalize(program)
        .map_err(|error| format!("{name} can't be found: {error}"))?;
    #[cfg(target_os = "macos")]
    {
        if program
            .extension()
            .is_some_and(|ending| ending.eq_ignore_ascii_case("app"))
        {
            let status = tokio::process::Command::new("/usr/bin/open")
                .arg("-a")
                .arg(&program)
                .arg(target)
                .stdin(Stdio::null())
                .status()
                .await
                .map_err(|error| format!("{name} could not be opened: {error}"))?;
            return if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "{name} could not be opened ({}).",
                    format_exit_detail(status.code())
                ))
            };
        }
    }
    if !file_access::fs::is_file(&program) {
        return Err(format!("{name} isn't a program."));
    }
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::engines::turn::own_group(&mut command);
    command.spawn().map(|_| ()).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("{name} can't be found.")
        } else {
            format!("{name} could not be opened: {error}")
        }
    })
}
