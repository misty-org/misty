//! Small things kept beside the records: traffic counts, secrets and notes.

use super::*;

impl LocalStore {
    /// Adds to what this session has sent and received today.
    pub fn add_traffic(&self, now_ms: u64, sent: u64, received: u64) -> Result<()> {
        let key = format!("traffic.{}", now_ms / 86_400_000);
        let (old_sent, old_received) = self
            .meta(&key)?
            .and_then(|value| serde_json::from_str::<(u64, u64)>(&value).ok())
            .unwrap_or_default();
        self.set_meta(
            &key,
            &serde_json::to_string(&(old_sent + sent, old_received + received))?,
        )?;
        // Older days aren't shown.
        let oldest = now_ms / 86_400_000;
        self.connection.execute(
            "DELETE FROM meta WHERE key LIKE 'traffic.%'
             AND CAST(substr(key, 9) AS INTEGER) < ?1",
            params![oldest.saturating_sub(31) as i64],
        )?;
        Ok(())
    }

    /// What this session sent and received over the last 30 days.
    pub fn traffic(&self, now_ms: u64) -> Result<(u64, u64)> {
        let today = (now_ms / 86_400_000) as i64;
        let mut statement = self.connection.prepare_cached(
            "SELECT value FROM meta WHERE key LIKE 'traffic.%'
             AND CAST(substr(key, 9) AS INTEGER) > ?1",
        )?;
        let rows = statement
            .query_map(params![today - 30], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .iter()
            .filter_map(|value| serde_json::from_str::<(u64, u64)>(value).ok())
            .fold((0, 0), |(sent, received), (a, b)| (sent + a, received + b)))
    }

    /// A small secret kept with the database, sealed under its key: this session's signing key.
    pub fn set_secret(&self, name: &str, value: &[u8]) -> Result<()> {
        let sealed = self.seal("", "secret", name, value)?;
        self.set_meta(
            &format!("secret.{name}"),
            &sealed
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
        )
    }

    pub fn secret(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let Some(hex) = self.meta(&format!("secret.{name}"))? else {
            return Ok(None);
        };
        let bytes = (0..hex.len())
            .step_by(2)
            .map(|i| {
                hex.get(i..i + 2)
                    .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                    .ok_or(Error::Invalid)
            })
            .collect::<Result<Vec<u8>>>()?;
        self.open_row("", "secret", name, &bytes).map(Some)
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn delete_meta(&self, key: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM meta WHERE key = ?1", params![key])?;
        Ok(())
    }

    /// A record's body, as stored.
    pub fn read_raw(
        &self,
        profile: &str,
        collection: &str,
        id: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let sealed: Option<Option<Vec<u8>>> = self
            .connection
            .query_row(
                "SELECT sealed FROM records WHERE profile = ?1 AND collection = ?2 AND id = ?3",
                params![profile, collection, id],
                |row| row.get(0),
            )
            .optional()?;
        sealed
            .flatten()
            .map(|sealed| self.open_row(profile, collection, id, &sealed))
            .transpose()
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}
