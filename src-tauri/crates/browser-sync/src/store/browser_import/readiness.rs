//! Readiness: whether every profile's committed credentials match a verified
//! native receipt.
use super::*;

pub(crate) fn equivalent(a: &[CredentialRecord], b: &[CredentialRecord]) -> Result<bool> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| Error::Recovery)?
        .as_secs() as i64;
    fn normalized(
        records: &[CredentialRecord],
        now: i64,
    ) -> Result<std::collections::BTreeMap<String, (u64, serde_json::Value)>> {
        let mut result = std::collections::BTreeMap::new();
        for record in records {
            let mut payload = record.area.canonical_payload(&record.payload)?;
            // A native engine omits expired cookies. Their absence is correct
            // and must not make an old, otherwise recoverable snapshot fail.
            // This is local read-back verification, not the shared reducer.
            if matches!(record.area, crate::document::credentials::Area::Cookies) {
                if let Some(cookies) = payload.as_array_mut() {
                    cookies.retain(|cookie| {
                        cookie["expires_unix_seconds"]
                            .as_i64()
                            .is_none_or(|expires| expires > now)
                    });
                }
            }
            if result
                .insert(
                    record.area.key(&record.profile_id)?,
                    (record.sequence, payload),
                )
                .is_some()
            {
                return Err(Error::Invalid);
            }
        }
        Ok(result)
    }
    Ok(normalized(a, now)? == normalized(b, now)?)
}

impl Store {
    pub fn browser_imports_pending(&self, root: &VaultRoot) -> Result<bool> {
        let mut query = self
            .connection
            .prepare("SELECT profile_id FROM sync_browser_imports LIMIT 65")?;
        let profiles: Vec<String> = query
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        if profiles.len() > MAX_PROFILES {
            return Err(Error::TooLarge);
        }
        // Authenticate every record; a plain SQL flag must not decide readiness.
        let mut pending = false;
        for profile in profiles {
            pending |= self
                .browser_import_journal(root, &profile)?
                .pending
                .is_some();
        }
        Ok(pending)
    }

    /// Readiness needs verified native receipts for the current committed
    /// credentials, including profiles never imported on this device before.
    pub fn browser_imports_verified(&self, root: &VaultRoot) -> Result<bool> {
        if self.browser_imports_pending(root)? {
            return Ok(false);
        }
        let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
        document.validate()?;
        let mut profiles = std::collections::BTreeMap::<String, Vec<CredentialRecord>>::new();
        for record in document.credentials.into_values() {
            profiles
                .entry(record.profile_id.clone())
                .or_default()
                .push(record);
        }
        for (profile, credentials) in profiles {
            let journal = self.browser_import_journal(root, &profile)?;
            let Some(applied) = journal.applied else {
                return Ok(false);
            };
            if !equivalent(&applied.credentials, &credentials)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
