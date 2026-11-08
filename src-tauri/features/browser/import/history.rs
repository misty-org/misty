//! Browsing history from the Chrome family (`History`), Firefox
//! (`places.sqlite`) and Safari (`History.db`), added to Misty's own history
//! with each visit's original time. Imported visits sync like local ones.
use super::discover::Family;
use super::model::{chromium_time_ms, web_address};
use super::snapshot::Snapshot;
use rusqlite::{params, Connection};
use std::path::Path;

/// Chrome keeps 90 days; this bounds a very busy profile.
pub const MAX_VISITS: usize = 200_000;
const TITLE_LIMIT: usize = 500;

pub struct Visit {
    pub url: String,
    pub title: String,
    pub visited_at: i64,
    pub typed: bool,
}

pub fn file(family: Family, profile: &Path) -> std::path::PathBuf {
    match family {
        Family::Chromium => profile.join("History"),
        Family::Firefox => profile.join("places.sqlite"),
        Family::Safari => profile.join("History.db"),
    }
}

pub fn read(family: Family, profile: &Path) -> Result<Vec<Visit>, String> {
    let snapshot = Snapshot::sqlite(&file(family, profile))?;
    read_from(family, &snapshot.open()?)
}

pub fn read_from(family: Family, db: &Connection) -> Result<Vec<Visit>, String> {
    // Newest first, so a cap keeps the most recent visits.
    let (query, to_ms): (&str, fn(i64) -> Option<i64>) = match family {
        // A typed navigation's core transition is 1 (`TYPED`).
        Family::Chromium => (
            "SELECT u.url, COALESCE(u.title, ''), v.visit_time, (v.transition & 255) = 1
             FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time DESC LIMIT ?1",
            chromium_time_ms,
        ),
        // Visit type 2 is a typed address.
        Family::Firefox => (
            "SELECT p.url, COALESCE(p.title, ''), v.visit_date, v.visit_type = 2
             FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
             ORDER BY v.visit_date DESC LIMIT ?1",
            |us| Some(us / 1000),
        ),
        // Safari stores seconds since 2001-01-01 as a float.
        Family::Safari => (
            "SELECT i.url, COALESCE(v.title, ''), CAST((v.visit_time + 978307200) * 1000 AS INTEGER), 0
             FROM history_visits v JOIN history_items i ON i.id = v.history_item
             ORDER BY v.visit_time DESC LIMIT ?1",
            Some,
        ),
    };
    let mut statement = db
        .prepare(query)
        .map_err(|_| "That browser's history could not be read.".to_owned())?;
    let rows = statement
        .query_map(params![MAX_VISITS as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })
        .map_err(|_| "That browser's history could not be read.".to_owned())?;
    Ok(rows
        .flatten()
        .filter_map(|(url, title, time, typed)| {
            Some(Visit {
                url: web_address(&url)?,
                title: title.trim().chars().take(TITLE_LIMIT).collect(),
                visited_at: to_ms(time).filter(|ms| *ms > 0)?,
                typed,
            })
        })
        .collect())
}

pub fn count(family: Family, profile: &Path) -> Result<usize, String> {
    let snapshot = Snapshot::sqlite(&file(family, profile))?;
    let db = snapshot.open()?;
    let table = match family {
        Family::Chromium => "visits",
        Family::Firefox => "moz_historyvisits",
        Family::Safari => "history_visits",
    };
    db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
        r.get::<_, i64>(0)
    })
    .map(|n| (n.max(0) as usize).min(MAX_VISITS))
    .map_err(|_| "That browser's history could not be read.".to_owned())
}

/// Adds visits to Misty's history under `profile`, skipping any already there
/// (the same page at the same moment), so importing twice adds nothing.
pub fn write(library: &mut Connection, profile: &str, visits: &[Visit]) -> Result<usize, String> {
    let error = |_| "Misty's history could not be updated.".to_owned();
    let transaction = library.transaction().map_err(error)?;
    let mut added = 0;
    {
        let mut insert = transaction
            .prepare(
                "INSERT INTO visits (profile_id, url, title, visited_at, typed)
                 SELECT ?1, ?2, ?3, ?4, ?5
                 WHERE NOT EXISTS (SELECT 1 FROM visits WHERE profile_id = ?1 AND url = ?2 AND visited_at = ?4)",
            )
            .map_err(error)?;
        for visit in visits {
            added += insert
                .execute(params![
                    profile,
                    visit.url,
                    visit.title,
                    visit.visited_at,
                    visit.typed
                ])
                .map_err(error)?;
        }
    }
    transaction.commit().map_err(error)?;
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
               url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', visited_at INTEGER NOT NULL,
               typed INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT '',
               changed INTEGER NOT NULL DEFAULT 1);",
        )
        .unwrap();
        db
    }

    #[test]
    fn reads_firefox_visits_and_imports_them_once() {
        let visits = read_from(Family::Firefox, &super::super::firefox::places_fixture()).unwrap();
        assert_eq!(visits.len(), 3);
        assert_eq!(visits[0].url, "https://acme.example/");
        assert!(visits.iter().any(|v| v.typed));
        let mut misty = library();
        assert_eq!(write(&mut misty, "default", &visits).unwrap(), 3);
        assert_eq!(write(&mut misty, "default", &visits).unwrap(), 0);
        let changed: i64 = misty
            .query_row(
                "SELECT COUNT(*) FROM visits WHERE changed = 1 AND origin = ''",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(changed, 3);
    }

    #[test]
    fn reads_chromium_visits_with_typed_transitions() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
             CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, transition INTEGER);
             INSERT INTO urls VALUES (1, 'https://a.example/', 'A'), (2, 'chrome://newtab/', 'New tab');
             INSERT INTO visits VALUES (1, 1, 13300000000000000, 805306369), (2, 1, 13300000001000000, 0),
               (3, 2, 13300000002000000, 1);",
        )
        .unwrap();
        let visits = read_from(Family::Chromium, &db).unwrap();
        assert_eq!(visits.len(), 2);
        assert_eq!(visits[1].visited_at, 1_655_526_400_000);
        assert!(visits[1].typed && !visits[0].typed);
    }
}
