//! Databases from before vaults per Space: found once, then moved to the
//! personal vault's path.
use super::database::{account_identity, sync_base};
use super::*;

/// The vault an older database belongs to: its cached vault, or for an older
/// identity without one, its device grant's.
pub(super) fn stored_vault_id(
    path: &std::path::Path,
    deployment: &str,
    account_id: &str,
) -> Result<Option<String>, String> {
    if let Some(cached) = Store::read_cached_vault(path, deployment, account_id).map_err(issue)? {
        return Ok(Some(cached.vault.vault_id));
    }
    if !Store::belongs_to_account(path, deployment, account_id).map_err(issue)? {
        return Ok(None);
    }
    let connection =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "Local sync storage is unavailable.")?;
    let grant: String = connection
        .query_row(
            "SELECT grant_json FROM sync_identity WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Local sync storage is unavailable.")?;
    let grant: misty_browser_sync::protocol::DeviceGrant =
        serde_json::from_str(&grant).map_err(|_| "Local sync storage is unavailable.")?;
    Ok(Some(grant.vault_id))
}

/// The account's database from before vaults per Space, if one exists: the
/// account folder, an earlier layout in the app's own data folder, or an
/// earlier workspace-scoped database.
pub(super) fn legacy_database(
    app: &tauri::AppHandle,
    deployment: &str,
    account_id: &str,
) -> Result<Option<PathBuf>, String> {
    let identity = account_identity(deployment, account_id)?;
    let earlier_base = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Local application storage is unavailable")?
        .join("browser-sync");
    let path = sync_base()?.join(&identity).join("workspace.sqlite");
    if path.is_file() {
        return Ok(Some(path));
    }
    let earlier = earlier_base.join(&identity).join("workspace.sqlite");
    if earlier.is_file() {
        return Ok(Some(earlier));
    }
    let mut previous = None;
    if earlier_base.is_dir() {
        let entries =
            std::fs::read_dir(&earlier_base).map_err(|_| "Could not inspect sync storage")?;
        for (index, entry) in entries.enumerate() {
            if index >= 1024 {
                return Err("Too many local vaults to select safely".into());
            }
            let entry = entry.map_err(|_| "Could not inspect sync storage")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.len() != 64 || !name.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                continue;
            }
            let candidate = entry.path().join("workspace.sqlite");
            if Store::belongs_to_account(&candidate, deployment, account_id).map_err(issue)? {
                if previous.is_some() {
                    return Err(
                        "Multiple older vaults need recovery before sync can select one.".into(),
                    );
                }
                previous = Some(candidate);
            }
        }
    }
    Ok(previous)
}
