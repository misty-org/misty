//! Collections on this machine, one sealed document each.
use rusqlite::{params, OptionalExtension};

use super::Store;
use crate::{collections::Collection, crypto::VaultRoot, Result};

impl Store {
    pub fn collection(&self, root: &VaultRoot, collection: &str) -> Result<Collection> {
        let sealed: Option<String> = self
            .connection
            .query_row(
                "SELECT state FROM sync_collections WHERE collection=?1",
                [collection],
                |r| r.get(0),
            )
            .optional()?;
        sealed
            .map(|s| self.open_workspace(root, &format!("records:{collection}"), &s))
            .transpose()
            .map(Option::unwrap_or_default)
    }

    pub fn set_collection(
        &mut self,
        root: &VaultRoot,
        collection: &str,
        state: &Collection,
    ) -> Result<()> {
        let sealed = self.seal_workspace(root, &format!("records:{collection}"), state)?;
        self.connection.execute(
            "INSERT INTO sync_collections VALUES(?1,?2) ON CONFLICT(collection) DO UPDATE SET state=excluded.state",
            params![collection, sealed],
        )?;
        Ok(())
    }
}
