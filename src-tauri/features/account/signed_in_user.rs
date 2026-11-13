use crate::app::runtime::MistyRuntime;
use file_access::paths;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize)]
pub struct NativeSystemInfo {
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

fn session_store() -> Result<database::store::Store, String> {
    paths::misty_home_dir()
        .map(|home| database::store::Store::in_home(&home))
        .ok_or_else(|| "Could not resolve Misty data directory".to_string())
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
    Ok(NativeSystemInfo {
        current_user: read_session().user,
    })
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
        Ok(NativeSystemInfo { current_user: None })
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

#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests;
