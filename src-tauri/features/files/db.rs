use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};

static SHARED: OnceLock<Mutex<rusqlite::Connection>> = OnceLock::new();

pub fn connect(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let backing = app
        .try_state::<permissions::Backing>()
        .ok_or_else(|| "Misty's data isn't open yet.".to_owned())?;
    backing
        .0
        .connect()
        .map_err(|error| format!("Misty's data couldn't be opened: {error}"))
}

pub fn with<T>(
    app: &AppHandle,
    work: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let shared = match SHARED.get() {
        Some(shared) => shared,
        None => {
            let fresh = connect(app)?;
            let _ = SHARED.set(Mutex::new(fresh));
            SHARED
                .get()
                .ok_or_else(|| "Misty's data isn't open yet.".to_owned())?
        }
    };
    let mut connection = shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    work(&mut connection)
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
