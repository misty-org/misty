//! Imports the browser library an earlier layout kept in `browser-library.sqlite`.
use rusqlite::{params, Connection};
use std::path::Path;

use crate::infra::store::Store;

/// Imports `browser-library.sqlite` of an earlier layout (downloads and visits), once. A
/// column an older build never added takes the new table's default.
pub(super) fn import(store: &Store, legacy: &Path) -> rusqlite::Result<()> {
    store.import_once("browser-library.sqlite", |connection| {
        if !legacy.is_file() {
            return Ok(());
        }
        let old = Connection::open_with_flags(legacy, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let columns = |table: &str| -> rusqlite::Result<Vec<String>> {
            old.prepare(&format!("PRAGMA table_info({table})"))?
                .query_map([], |row| row.get::<_, String>(1))?
                .collect()
        };
        let pick = |have: &[String], name: &str, fallback: &str| -> String {
            if have.iter().any(|column| column == name) {
                name.to_owned()
            } else {
                fallback.to_owned()
            }
        };
        let downloads = columns("downloads")?;
        if !downloads.is_empty() {
            let mut statement = old.prepare(
                "SELECT id,url,path,state,error,received,total,started_at,finished_at FROM downloads",
            )?;
            for row in statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                ))
            })? {
                let r = row?;
                connection.execute(
                    "INSERT OR IGNORE INTO downloads (id,url,path,state,error,received,total,started_at,finished_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![r.0, r.1, r.2, r.3, r.4, r.5, r.6, r.7, r.8],
                )?;
            }
        }
        let visits = columns("visits")?;
        if !visits.is_empty() {
            let select = format!(
                "SELECT profile_id,url,title,visited_at,{},{},{} FROM visits ORDER BY id",
                pick(&visits, "typed", "0"),
                pick(&visits, "origin", "''"),
                pick(&visits, "changed", "1"),
            );
            let mut statement = old.prepare(&select)?;
            for row in statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })? {
                let r = row?;
                connection.execute(
                    "INSERT INTO visits (profile_id,url,title,visited_at,typed,origin,changed)
                     VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![r.0, r.1, r.2, r.3, r.4, r.5, r.6],
                )?;
            }
        }
        if !columns("history_dirty")?.is_empty() {
            let mut statement = old.prepare("SELECT origin,hour FROM history_dirty")?;
            for row in statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })? {
                let (origin, hour) = row?;
                connection.execute(
                    "INSERT OR IGNORE INTO history_dirty (origin,hour) VALUES (?1,?2)",
                    params![origin, hour],
                )?;
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::super::open;
    use super::*;

    #[test]
    fn an_earlier_library_imports_once_and_interrupted_downloads_are_marked() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("browser-library.sqlite");
        {
            // The first build's shape: no typed, origin or changed columns.
            let old = Connection::open(&legacy).unwrap();
            old.execute_batch(
                "CREATE TABLE downloads (id TEXT PRIMARY KEY, url TEXT NOT NULL, path TEXT NOT NULL,
                     state TEXT NOT NULL, error TEXT, received INTEGER NOT NULL DEFAULT 0,
                     total INTEGER NOT NULL DEFAULT -1, started_at INTEGER NOT NULL, finished_at INTEGER);
                 CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
                     url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', visited_at INTEGER NOT NULL);
                 INSERT INTO downloads VALUES ('d1','https://a.example/f','/tmp/f','in_progress',NULL,5,10,1,NULL);
                 INSERT INTO visits (profile_id,url,title,visited_at) VALUES ('p','https://a.example/','A',100);",
            )
            .unwrap();
        }
        let store = Store::at(directory.path().join("misty.db"));
        let connection = open(&store, &legacy).unwrap();
        let state: String = connection
            .query_row("SELECT state FROM downloads WHERE id='d1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(state, "interrupted");
        let (typed, origin, changed): (i64, String, i64) = connection
            .query_row(
                "SELECT typed, origin, changed FROM visits WHERE url='https://a.example/'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((typed, origin.as_str(), changed), (0, "", 1));
        // Deleting a visit is not undone by opening again.
        connection.execute("DELETE FROM visits", []).unwrap();
        drop(connection);
        let reopened = open(&store, &legacy).unwrap();
        let count: i64 = reopened
            .query_row("SELECT COUNT(*) FROM visits", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
