//! Leaving a vault, deleting a profile, and counting what is stored.

use super::*;

impl LocalStore {
    /// Leaves the vault behind: every live record is local again and would upload to a new
    /// vault from scratch, and deletions the old server needed are forgotten.
    pub fn unlink(&mut self) -> Result<()> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM records WHERE sealed IS NULL", [])?;
        tx.execute("UPDATE records SET version = 0, dirty = 1", [])?;
        tx.execute(
            "DELETE FROM meta WHERE key LIKE 'vault.%' OR key LIKE 'secret.%'",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Everything a deleted profile kept.
    pub fn remove_profile(&mut self, profile: &str) -> Result<()> {
        self.connection
            .execute("DELETE FROM records WHERE profile = ?1", params![profile])?;
        self.forget_profile_meta(profile)
    }

    /// Notes kept about a profile under `<kind>.<profile>`, sealed or not.
    fn forget_profile_meta(&self, profile: &str) -> Result<()> {
        let mut statement = self.connection.prepare_cached("SELECT key FROM meta")?;
        let keys = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let suffix = format!(".{profile}");
        for key in keys.iter().filter(|key| key.ends_with(&suffix)) {
            self.connection
                .execute("DELETE FROM meta WHERE key = ?1", params![key])?;
        }
        Ok(())
    }

    /// Deletes a profile for every session: what's on the server is marked for deletion, what never
    /// left goes now.
    pub fn erase_profile(&mut self, profile: &str) -> Result<()> {
        let edited_at = self.tick();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "DELETE FROM records WHERE profile = ?1 AND version = 0",
            params![profile],
        )?;
        tx.execute(
            "UPDATE records SET sealed = NULL, edited_at = ?2, dirty = 1 WHERE profile = ?1",
            params![profile, edited_at as i64],
        )?;
        tx.commit()?;
        self.forget_profile_meta(profile)
    }

    /// What's waiting to go, and what was set aside. Both are read from an index: this runs often.
    pub fn waiting(&self) -> Result<(u64, u64)> {
        let count = |state: i64| -> Result<u64> {
            Ok(self.connection.query_row(
                "SELECT COUNT(*) FROM records WHERE dirty = ?1",
                params![state],
                |row| row.get::<_, i64>(0),
            )? as u64)
        };
        Ok((count(1)?, count(2)?))
    }

    pub fn totals(&self) -> Result<Totals> {
        Ok(self.connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(dirty = 1), 0) FROM records WHERE sealed IS NOT NULL OR dirty = 1",
            [],
            |row| {
                Ok(Totals {
                    records: row.get::<_, i64>(0)? as u64,
                    waiting: row.get::<_, i64>(1)? as u64,
                })
            },
        )?)
    }
}
