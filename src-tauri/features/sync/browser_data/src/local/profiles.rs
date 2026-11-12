//! Deleting a profile.

use super::*;

impl LocalStore {
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
}
