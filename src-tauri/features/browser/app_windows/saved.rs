//! Where the profile list is kept: one row of `settings_state` in `misty.db`, beside this device's
//! other marks. The `profiles` folder holds website data only (`profile_store`).
//!
//! A computer that kept the list in `~/.misty/profiles.json` brings it over once. Losing
//! `legacyOwner` could sign someone out of every site, so a database or file that couldn't be read
//! is an error here, never an empty list that the next save would write over the real one.
use super::{OpenWindow, ProfileEntry};
use database::store::Store;
use file_access::fs;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Saved {
    #[serde(default)]
    pub(super) scope: Option<String>,
    #[serde(default)]
    pub(super) legacy_owner: Option<String>,
    #[serde(default)]
    pub(super) profiles: BTreeMap<String, BTreeMap<String, ProfileEntry>>,
    #[serde(default)]
    pub(super) open: Vec<OpenWindow>,
    #[serde(default)]
    pub(super) orphans: BTreeMap<String, Vec<String>>,
}

/// The document last written, so a save that changes nothing never touches the database.
static WRITTEN: Mutex<Option<String>> = Mutex::new(None);

struct Place {
    store: Store,
    /// The row's `scope` in `settings_state`.
    row: String,
    /// Where an earlier build kept this list.
    old_file: PathBuf,
}

fn place_in(home: &Path) -> Place {
    Place {
        store: Store::in_home(home),
        row: "profile-registry".to_owned(),
        old_file: home.join("profiles.json"),
    }
}

fn place() -> Option<Place> {
    Some(place_in(&file_access::paths::misty_home_dir()?))
}

/// The saved list. `Err` means it couldn't be read, and may well exist.
pub(super) fn read() -> Result<Saved, String> {
    match place() {
        Some(place) => read_from(&place),
        None => Ok(Saved::default()),
    }
}

fn read_from(place: &Place) -> Result<Saved, String> {
    let connection = place.store.connect().map_err(|error| error.to_string())?;
    let row: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [&place.row],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match row {
        Some(document) => Ok(serde_json::from_str(&document).unwrap_or_else(|_| {
            eprintln!("The saved profile list is damaged; starting a new one.");
            Saved::default()
        })),
        None => import_old_file(&connection, place),
    }
}

/// Brings over the file an earlier build left, then removes it. It goes only once its contents
/// are safely in the database.
fn import_old_file(connection: &Connection, place: &Place) -> Result<Saved, String> {
    let bytes = match fs::read(&place.old_file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Saved::default()),
        Err(error) => return Err(error.to_string()),
    };
    // A damaged file has nothing to bring over; it stays in case someone wants to look at it.
    let Ok(saved) = serde_json::from_slice::<Saved>(&bytes) else {
        eprintln!("The old profile list is damaged; starting a new one.");
        return Ok(Saved::default());
    };
    let document = serde_json::to_string(&saved).map_err(|error| error.to_string())?;
    write_row(connection, &place.row, &document).map_err(|error| error.to_string())?;
    if let Err(error) = fs::remove_file(&place.old_file) {
        eprintln!("Could not remove the old profile list: {error}");
    }
    let _ = fs::remove_file(place.old_file.with_extension("json.tmp"));
    Ok(saved)
}

fn write_row(connection: &Connection, row: &str, document: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
         ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
        params![row, document],
    )?;
    Ok(())
}

/// Saves the list if it changed. A save that fails is tried again by the next one.
pub(super) fn write(saved: &Saved) {
    let Ok(document) = serde_json::to_string(saved) else {
        return;
    };
    let Ok(mut written) = WRITTEN.lock() else {
        return;
    };
    if written.as_deref() == Some(document.as_str()) {
        return;
    }
    let Some(place) = place() else { return };
    let result = place
        .store
        .connect()
        .and_then(|connection| write_row(&connection, &place.row, &document));
    match result {
        Ok(()) => *written = Some(document),
        Err(error) => eprintln!("Could not save the profile list: {error}"),
    }
}

#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests {
    use super::*;

    const OLD: &str = r#"{
        "scope": "https://a|one",
        "legacyOwner": "https://a|one",
        "profiles": {"https://a|one": {"personal": {"id": "personal", "name": "Personal", "order": 0.0}}},
        "open": [{"profile": "personal", "windowId": "w1"}],
        "orphans": {"personal": ["w2"]}
    }"#;

    fn home() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn brings_the_old_file_over_once_and_removes_it() {
        let home = home();
        let place = place_in(home.path());
        std::fs::write(&place.old_file, OLD).unwrap();
        std::fs::write(place.old_file.with_extension("json.tmp"), "partial").unwrap();

        let saved = read_from(&place).unwrap();
        assert_eq!(saved.legacy_owner.as_deref(), Some("https://a|one"));
        assert_eq!(saved.scope.as_deref(), Some("https://a|one"));
        assert_eq!(saved.profiles["https://a|one"]["personal"].name, "Personal");
        assert_eq!(saved.open[0].window_id, "w1");
        assert_eq!(saved.orphans["personal"], ["w2"]);
        assert!(!place.old_file.exists());
        assert!(!place.old_file.with_extension("json.tmp").exists());

        // The row is what counts from now on, even if an old build writes the file again.
        std::fs::write(
            &place.old_file,
            r#"{"legacyOwner": "https://a|someone-else"}"#,
        )
        .unwrap();
        assert_eq!(
            read_from(&place).unwrap().legacy_owner.as_deref(),
            Some("https://a|one")
        );
    }

    #[test]
    fn a_new_computer_starts_with_an_empty_list() {
        let home = home();
        let saved = read_from(&place_in(home.path())).unwrap();
        assert!(saved.legacy_owner.is_none() && saved.profiles.is_empty());
    }

    #[test]
    fn a_file_it_cannot_read_is_not_taken_for_an_empty_list() {
        let home = home();
        let place = place_in(home.path());
        // Reading a folder fails with something other than "not found".
        std::fs::create_dir(&place.old_file).unwrap();
        assert!(read_from(&place).is_err());
        // Nothing was saved in its place, so it still comes over once it can be read.
        std::fs::remove_dir(&place.old_file).unwrap();
        std::fs::write(&place.old_file, OLD).unwrap();
        assert_eq!(
            read_from(&place).unwrap().legacy_owner.as_deref(),
            Some("https://a|one")
        );
    }

    #[test]
    fn a_damaged_file_is_left_where_it_is() {
        let home = home();
        let place = place_in(home.path());
        std::fs::write(&place.old_file, "not json").unwrap();
        assert!(read_from(&place).unwrap().legacy_owner.is_none());
        assert!(place.old_file.exists());
    }

    #[test]
    fn saving_again_replaces_the_row() {
        let home = home();
        let place = place_in(home.path());
        let connection = place.store.connect().unwrap();
        write_row(&connection, &place.row, r#"{"scope": "first"}"#).unwrap();
        write_row(&connection, &place.row, r#"{"scope": "second"}"#).unwrap();
        assert_eq!(read_from(&place).unwrap().scope.as_deref(), Some("second"));
    }
}
