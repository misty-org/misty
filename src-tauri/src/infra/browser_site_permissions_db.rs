//! Persistent site permission choices, per browser profile, in `misty.db` (shared by the
//! macOS and the Windows/Linux stores; private sessions never come here).
use super::Permissions;
use crate::infra::store::Store;
use std::collections::BTreeMap;

type PermissionStore = BTreeMap<String, BTreeMap<String, Permissions>>;

fn store() -> Option<Store> {
    super::super::paths::misty_home_dir()
        .map(|home| Store::at(home.join(".local").join("data").join("misty.db")))
}

pub(super) fn read_all_from(store: &Store) -> PermissionStore {
    let Ok(connection) = store.connect() else {
        return PermissionStore::new();
    };
    let Ok(mut statement) =
        connection.prepare("SELECT profile, origin, permissions FROM site_permissions")
    else {
        return PermissionStore::new();
    };
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    });
    let mut all = PermissionStore::new();
    if let Ok(rows) = rows {
        for (profile, origin, raw) in rows.flatten() {
            if let Ok(permissions) = serde_json::from_str::<Permissions>(&raw) {
                all.entry(profile).or_default().insert(origin, permissions);
            }
        }
    }
    all
}

pub(super) fn write_all_to(store: &Store, all: &PermissionStore) -> Result<(), String> {
    let mut connection = store.connect().map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM site_permissions", [])
        .map_err(|error| error.to_string())?;
    for (profile, sites) in all {
        for (origin, permissions) in sites {
            let raw = serde_json::to_string(permissions).map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "INSERT INTO site_permissions (profile, origin, permissions) VALUES (?1, ?2, ?3)",
                    rusqlite::params![profile, origin, raw],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(super) fn read_all() -> PermissionStore {
    store().map(|store| read_all_from(&store)).unwrap_or_default()
}

pub(super) fn write_all(all: &PermissionStore) -> Result<(), String> {
    write_all_to(&store().ok_or("Misty's data folder is unavailable.")?, all)
}

/// Imports the choices an earlier layout kept elsewhere (a JSON file, or the macOS
/// preferences), once. `earlier` returns their JSON text.
pub(super) fn import_earlier_once(earlier: impl FnOnce() -> Option<String>) {
    let Some(store) = store() else {
        return;
    };
    let _ = store.import_once("site-permissions", |connection| -> Result<(), rusqlite::Error> {
        let Some(raw) = earlier() else {
            return Ok(());
        };
        let Ok(all) = serde_json::from_str::<PermissionStore>(&raw) else {
            return Ok(());
        };
        for (profile, sites) in all {
            for (origin, permissions) in sites {
                if let Ok(raw) = serde_json::to_string(&permissions) {
                    connection.execute(
                        "INSERT OR IGNORE INTO site_permissions (profile, origin, permissions) VALUES (?1, ?2, ?3)",
                        rusqlite::params![profile, origin, raw],
                    )?;
                }
            }
        }
        Ok(())
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use kiri::permissions::Decision;

    #[test]
    fn choices_round_trip_per_profile_and_origin() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let allowed = Permissions {
            camera: Decision::Allow,
            microphone: Decision::Ask,
        };
        let mut all = PermissionStore::new();
        all.entry("profile-a".into())
            .or_default()
            .insert("https://example.com".into(), allowed.clone());
        write_all_to(&store, &all).unwrap();
        assert_eq!(read_all_from(&store), all);
        write_all_to(&store, &PermissionStore::new()).unwrap();
        assert!(read_all_from(&store).is_empty());
    }
}
