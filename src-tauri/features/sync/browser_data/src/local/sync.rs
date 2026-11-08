//! Getting records to and from the server: what is waiting, what was accepted, what arrived.

use super::*;

impl LocalStore {
    /// The oldest changes waiting to go to the server. A row that can't be opened is left out
    /// and stays dirty, so one damaged row never holds back the others.
    pub fn dirty(&self, limit: usize) -> Result<Vec<DirtyRow>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT profile, collection, id, sealed, edited_at, version FROM records
             WHERE dirty = 1 ORDER BY edited_at LIMIT ?1",
        )?;
        let rows = statement
            .query_map(params![limit as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, i64>(4)? as u64,
                    row.get::<_, i64>(5)? as u64,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|(profile, collection, id, sealed, edited_at, version)| {
                let plaintext = match sealed {
                    Some(sealed) => Some(self.open_row(&profile, &collection, &id, &sealed).ok()?),
                    None => None,
                };
                Some(DirtyRow {
                    profile,
                    collection,
                    id,
                    plaintext,
                    edited_at,
                    version,
                })
            })
            .collect())
    }

    /// What to send next: everything people notice first, history and memory last. `with_history`
    /// holds them back until their slower batch is due. A row set aside is left out.
    pub fn dirty_for_push(&self, limit: usize, with_history: bool) -> Result<Vec<DirtyRow>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT profile, collection, id, sealed, edited_at, version FROM records
             WHERE dirty = 1 AND (?2 OR collection NOT IN ('history', 'memory'))
             ORDER BY CASE collection
                 WHEN 'profiles' THEN 0
                 WHEN 'tabs' THEN 1
                 WHEN 'tab_groups' THEN 1
                 WHEN 'bookmarks' THEN 2
                 WHEN 'cookies' THEN 3
                 WHEN 'passwords' THEN 3
                 WHEN 'autofill' THEN 3
                 WHEN 'history' THEN 9
                 WHEN 'memory' THEN 9
                 ELSE 5 END, edited_at
             LIMIT ?1",
        )?;
        let rows = statement
            .query_map(params![limit as i64, with_history], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                    row.get::<_, i64>(4)? as u64,
                    row.get::<_, i64>(5)? as u64,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut out = Vec::with_capacity(rows.len());
        for (profile, collection, id, sealed, edited_at, version) in rows {
            let plaintext = match sealed {
                Some(sealed) => match self.open_row(&profile, &collection, &id, &sealed) {
                    Ok(plain) => Some(plain),
                    // Damaged here: nothing to send, ever. It must not block what's behind it.
                    Err(_) => {
                        self.set_aside(&profile, &collection, &id)?;
                        continue;
                    }
                },
                None => None,
            };
            out.push(DirtyRow {
                profile,
                collection,
                id,
                plaintext,
                edited_at,
                version,
            });
        }
        Ok(out)
    }

    /// Stops trying to send a record that can't be sent. It stays usable here and is listed in
    /// Settings, and its next edit tries again.
    pub fn set_aside(&self, profile: &str, collection: &str, id: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE records SET dirty = 2 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
            params![profile, collection, id],
        )?;
        Ok(())
    }

    /// How many records were set aside, by collection.
    pub fn set_aside_counts(&self) -> Result<Vec<(String, u64)>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT collection, COUNT(*) FROM records WHERE dirty = 2 GROUP BY collection",
        )?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The server holds a copy nobody can read: this row's edit will replace it.
    pub fn rebase(&self, profile: &str, collection: &str, id: &str, version: u64) -> Result<()> {
        self.connection.execute(
            "UPDATE records SET version = ?4 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
            params![profile, collection, id, version as i64],
        )?;
        Ok(())
    }

    /// The server's listing is starting from nothing because this session was away past what it
    /// keeps. Rows it mentions get the mark cleared; `finish_full_listing` then drops what it
    /// never mentioned. A row with a local change is kept, whatever the server says.
    pub fn begin_full_listing(&self) -> Result<()> {
        self.connection.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS listed (profile TEXT, collection TEXT, id TEXT,
                 PRIMARY KEY (profile, collection, id));
             DELETE FROM temp.listed;",
        )?;
        self.set_meta("vault.listing", "1")
    }

    pub fn finish_full_listing(&self) -> Result<()> {
        self.connection.execute(
            "INSERT OR IGNORE INTO inbox (profile, collection, id)
             SELECT profile, collection, id FROM records
             WHERE collection = ?1 AND dirty = 0 AND version > 0 AND NOT EXISTS (
                 SELECT 1 FROM temp.listed l WHERE l.profile = records.profile
                     AND l.collection = records.collection AND l.id = records.id)",
            params![crate::collections::MEMORY],
        )?;
        self.connection.execute(
            "DELETE FROM records WHERE dirty = 0 AND version > 0 AND NOT EXISTS (
                 SELECT 1 FROM temp.listed l WHERE l.profile = records.profile
                     AND l.collection = records.collection AND l.id = records.id)",
            [],
        )?;
        self.connection
            .execute("DELETE FROM meta WHERE key = 'vault.listing'", [])?;
        self.connection.execute("DELETE FROM temp.listed", [])?;
        Ok(())
    }

    /// The server accepted a change at `version`. A newer edit made meanwhile stays dirty.
    pub fn accepted(
        &mut self,
        profile: &str,
        collection: &str,
        id: &str,
        edited_at: u64,
        version: u64,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE records
             SET version = ?5, dirty = CASE WHEN edited_at = ?4 THEN 0 ELSE dirty END
             WHERE profile = ?1 AND collection = ?2 AND id = ?3 AND version <= ?5",
            params![profile, collection, id, edited_at as i64, version as i64],
        )?;
        Ok(())
    }

    /// A copy from the server. The newer edit wins; a local edit that wins goes out next, on
    /// the server's version. A version this machine has passed is refused, so a server can't
    /// roll a record back.
    pub fn apply_remote(
        &mut self,
        profile: &str,
        collection: &str,
        id: &str,
        version: u64,
        edited_at: u64,
        plain: Option<&[u8]>,
    ) -> Result<Applied> {
        self.clock = self.clock.max(edited_at);
        if self.meta("vault.listing")?.is_some() {
            self.connection.execute(
                "INSERT OR IGNORE INTO temp.listed (profile, collection, id) VALUES (?1, ?2, ?3)",
                params![profile, collection, id],
            )?;
        }
        let row: Option<(u64, u64, bool)> = self
            .connection
            .query_row(
                "SELECT version, edited_at, dirty FROM records
                 WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)? as u64,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, i64>(2)? != 0,
                    ))
                },
            )
            .optional()?;
        if let Some((local_version, local_edit, dirty)) = row {
            if version < local_version {
                return Ok(Applied::Ignored);
            }
            if dirty && local_edit > edited_at {
                self.connection.execute(
                    "UPDATE records SET version = ?4
                     WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                    params![profile, collection, id, version as i64],
                )?;
                return Ok(Applied::KeptLocal);
            }
            if !dirty && version == local_version {
                return Ok(Applied::Ignored);
            }
        }
        let sealed = plain
            .map(|plain| self.seal(profile, collection, id, plain))
            .transpose()?;
        self.connection.execute(
            "INSERT INTO records (profile, collection, id, sealed, edited_at, version, dirty)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
             ON CONFLICT (profile, collection, id) DO UPDATE SET
               sealed = excluded.sealed, edited_at = excluded.edited_at,
               version = excluded.version, dirty = 0",
            params![
                profile,
                collection,
                id,
                sealed,
                edited_at as i64,
                version as i64
            ],
        )?;
        if INBOX_COLLECTIONS.contains(&collection) {
            self.connection.execute(
                "INSERT OR IGNORE INTO inbox (profile, collection, id) VALUES (?1, ?2, ?3)",
                params![profile, collection, id],
            )?;
        }
        Ok(Applied::Replaced)
    }

    /// Records the server changed that nobody has taken yet: the body, or `None` for a deletion. A row
    /// that can't be opened is dropped from the list, since nobody here can ever read it.
    pub fn inbox(
        &self,
        profile: &str,
        collection: &str,
        limit: usize,
    ) -> Result<Vec<(String, Option<Zeroizing<Vec<u8>>>)>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT i.id, r.sealed FROM inbox i LEFT JOIN records r
                 ON r.profile = i.profile AND r.collection = i.collection AND r.id = i.id
             WHERE i.profile = ?1 AND i.collection = ?2 LIMIT ?3",
        )?;
        let rows = statement
            .query_map(params![profile, collection, limit as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<Vec<u8>>>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, sealed) in rows {
            match sealed {
                None => out.push((id, None)),
                Some(sealed) => match self.open_row(profile, collection, &id, &sealed) {
                    Ok(plain) => out.push((id, Some(plain))),
                    Err(_) => self.inbox_done(profile, collection, std::slice::from_ref(&id))?,
                },
            }
        }
        Ok(out)
    }

    /// These records have been taken. A record changed again meanwhile is listed again by that change.
    pub fn inbox_done(&self, profile: &str, collection: &str, ids: &[String]) -> Result<()> {
        let mut statement = self.connection.prepare_cached(
            "DELETE FROM inbox WHERE profile = ?1 AND collection = ?2 AND id = ?3",
        )?;
        for id in ids {
            statement.execute(params![profile, collection, id])?;
        }
        Ok(())
    }
}
