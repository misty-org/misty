//! Files' tables in `misty.db` (Starred, Recent and the Trash's put-back ledger), reached through
//! the store the app manages at launch, the way `permissions` reaches `settings_state`. They stay
//! on this device and never sync.
use tauri::{AppHandle, Manager};

/// A connection to `misty.db`, its migrations applied.
pub fn connect(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let backing = app
        .try_state::<permissions::Backing>()
        .ok_or_else(|| "Misty's data isn't open yet.".to_owned())?;
    backing
        .0
        .connect()
        .map_err(|error| format!("Misty's data couldn't be opened: {error}"))
}

/// Now, in milliseconds since 1970, as the tables keep it.
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
