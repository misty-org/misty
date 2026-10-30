use crate::app::runtime::MistyRuntime;
use crate::infra::paths;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Debug, Serialize)]
pub struct NativeSystemInfo {
    os: String,
    arch: String,
    misty_home: String,
    install_dir: String,
    legacy_install_dir: String,
    db_path: String,
    setup_path: String,
    installed_version: Option<String>,
    current_user: Option<CurrentUser>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CurrentUser {
    id: String,
    #[serde(default)]
    username: String,
    email: String,
}
/// The account this device last signed in with. The server owns the account; this only
/// lets the app show who is signed in. Records from earlier builds also carried a
/// license; it is ignored on read and dropped on the next write.
/// It lives in `misty.db` with everything else (sign-in already depends on that
/// database, since the account's tokens are in it).
#[derive(Default, Serialize, Deserialize)]
struct StoredSession {
    user: Option<CurrentUser>,
}

static SESSION_LOCK: Mutex<()> = Mutex::new(());

fn session_store() -> Result<super::store::Store, String> {
    misty_home_dir()
        .map(|home| super::store::Store::at(home.join(".local").join("data").join("misty.db")))
}

fn read_session() -> StoredSession {
    // A missing or damaged record is a signed-out device, never an error.
    session_store()
        .ok()
        .and_then(|store| store.connect().ok())
        .and_then(|connection| {
            connection
                .query_row("SELECT document FROM session WHERE id = 1", [], |row| {
                    row.get::<_, String>(0)
                })
                .ok()
        })
        .and_then(|document| serde_json::from_str(&document).ok())
        .unwrap_or_default()
}

fn write_session(session: &StoredSession) -> Result<(), String> {
    let document = serde_json::to_string(session).map_err(|error| error.to_string())?;
    let connection = session_store()?
        .connect()
        .map_err(|error| format!("Could not open the Misty database: {error}"))?;
    connection
        .execute(
            "INSERT INTO session (id, document) VALUES (1, ?1)
             ON CONFLICT (id) DO UPDATE SET document = excluded.document",
            [document],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not save the Misty session: {error}"))
}

fn session_info() -> Result<NativeSystemInfo, String> {
    let stored = read_session();
    build_system_info(stored.user)
}

/// Async so the file work never runs on the UI thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn check_system() -> Result<NativeSystemInfo, String> {
    blocking(session_info).await
}

#[tauri::command]
pub async fn sign_out_misty(
    _state: tauri::State<'_, MistyRuntime>,
) -> Result<NativeSystemInfo, String> {
    blocking(|| {
        let _guard = SESSION_LOCK.lock().map_err(|_| "Misty session is busy.")?;
        write_session(&StoredSession::default())?;
        build_system_info(None)
    })
    .await
}

#[tauri::command]
pub async fn save_authenticated_user(user: CurrentUser) -> Result<NativeSystemInfo, String> {
    blocking(move || {
        let _guard = SESSION_LOCK.lock().map_err(|_| "Misty session is busy.")?;
        write_session(&StoredSession { user: Some(user) })?;
        session_info()
    })
    .await
}

fn build_system_info(current_user: Option<CurrentUser>) -> Result<NativeSystemInfo, String> {
    let home = misty_home_dir()?;
    let install_dir = misty_bin_dir()?;
    let legacy_install_dir = legacy_misty_bin_dir()?;
    let db_path = misty_db_path()?;
    let setup_path = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("Misty"))
        .display()
        .to_string();
    let installed_version = read_installed_version(&home)?;

    Ok(NativeSystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        misty_home: home.display().to_string(),
        install_dir: install_dir.display().to_string(),
        legacy_install_dir: legacy_install_dir.display().to_string(),
        db_path: db_path.display().to_string(),
        setup_path,
        installed_version,
        current_user,
    })
}

fn misty_home_dir() -> Result<PathBuf, String> {
    paths::misty_home_dir().ok_or_else(|| "Could not resolve Misty data directory".to_string())
}

fn misty_bin_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join(".local").join("bin"))
}

fn legacy_misty_bin_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join("local").join("bin"))
}

fn misty_db_path() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join(".local").join("data").join("misty.db"))
}

fn installed_version_path(home: &Path) -> PathBuf {
    home.join(".version")
}

fn read_installed_version(home: &Path) -> Result<Option<String>, String> {
    let path = installed_version_path(home);
    if !path.exists() {
        return Ok(None);
    }
    let version = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read installed Misty version: {error}"))?
        .trim()
        .to_string();
    Ok((!version.is_empty()).then_some(version))
}

#[cfg(test)]
mod tests;
