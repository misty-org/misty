use tauri::{AppHandle, Manager};

pub fn connect(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let backing = app
        .try_state::<permissions::Backing>()
        .ok_or_else(|| "Misty's data isn't open yet.".to_owned())?;
    backing
        .0
        .connect()
        .map_err(|error| format!("Misty's data couldn't be opened: {error}"))
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
