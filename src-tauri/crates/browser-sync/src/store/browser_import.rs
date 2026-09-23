//! Native-only write-ahead record for browser side effects. A pending receipt
//! survives process death and blocks capture/readiness until native read-back
//! verifies the whole target. This journal never crosses renderer IPC.
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::Store;
use crate::{
    crypto::VaultRoot,
    document::{entities, CredentialRecord, Document},
    protocol::{valid_id, MAX_COUNTER},
    Error, Result,
};

const MAX_JOURNAL_BYTES: usize = 16 << 20;
const MAX_PROFILES: usize = 64;
const MAX_AREAS: usize = 16_384;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserImportReceipt {
    pub id: String,
    pub snapshot_sequence: u64,
    pub credentials: Vec<CredentialRecord>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserImportJournal {
    pub revision: u64,
    pub applied: Option<BrowserImportReceipt>,
    pub pending: Option<BrowserImportReceipt>,
    pub quarantined: bool,
}

pub(super) fn record_key(profile: &str, revision: u64) -> String {
    format!("browser-import:v1:{profile}:{revision}")
}

pub(super) fn validate(profile: &str, journal: &BrowserImportJournal) -> Result<()> {
    if !entities::profile_id(profile)
        || journal.revision > MAX_COUNTER
        || (journal.quarantined && journal.pending.is_none())
    {
        return Err(Error::Invalid);
    }
    for receipt in [&journal.applied, &journal.pending].into_iter().flatten() {
        if !valid_id(&receipt.id)
            || receipt.snapshot_sequence > MAX_COUNTER
            || receipt.credentials.len() > MAX_AREAS
        {
            return Err(Error::Invalid);
        }
        let mut keys = std::collections::BTreeSet::new();
        for credential in &receipt.credentials {
            if credential.profile_id != profile
                || credential.sequence == 0
                || credential.sequence > receipt.snapshot_sequence
                || !keys.insert(credential.area.key(profile)?)
            {
                return Err(Error::Invalid);
            }
            credential.area.validate_payload(&credential.payload)?;
        }
    }
    if let (Some(applied), Some(pending)) = (&journal.applied, &journal.pending) {
        if pending.snapshot_sequence < applied.snapshot_sequence {
            return Err(Error::Sequence);
        }
    }
    Ok(())
}

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
    pub fn browser_import_journal(
        &self,
        root: &VaultRoot,
        profile: &str,
    ) -> Result<BrowserImportJournal> {
        if !entities::profile_id(profile) {
            return Err(Error::Invalid);
        }
        let row: Option<(u64, String)> = self
            .connection
            .query_row(
                "SELECT revision,journal FROM sync_browser_imports WHERE profile_id=?1",
                [profile],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((revision, encoded)) = row else {
            return Ok(BrowserImportJournal::default());
        };
        let bytes = root.open_local(
            &self.scope,
            &self.grant.device_id,
            &record_key(profile, revision),
            &serde_json::from_str(&encoded)?,
        )?;
        let journal: BrowserImportJournal = serde_json::from_slice(&bytes)?;
        if journal.revision != revision {
            return Err(Error::Identity);
        }
        validate(profile, &journal)?;
        Ok(journal)
    }

    /// Select the complete profile credential target from authenticated committed
    /// state, never a tentative outbox version or renderer-supplied payload.
    /// Call only after native preflight confirms all target areas are supported.
    pub fn begin_browser_import(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        expected_revision: u64,
        id: &str,
        snapshot_sequence: u64,
    ) -> Result<BrowserImportJournal> {
        if !valid_id(id) {
            return Err(Error::Invalid);
        }
        let binding = self.browser_profile_binding(root, profile)?;
        if binding.revision > 0
            && binding
                .staged
                .as_ref()
                .or(binding.active.as_ref())
                .map(|stage| stage.id.as_str())
                != Some(id)
        {
            return Err(Error::Identity);
        }
        let mut journal = self.browser_import_journal(root, profile)?;
        // The caller can recover a lost local response without allocating a
        // second import. Different work cannot replace an unfinished restore.
        if let Some(pending) = &journal.pending {
            return if pending.id == id && pending.snapshot_sequence == snapshot_sequence {
                Ok(journal)
            } else {
                Err(Error::Recovery)
            };
        }
        if let Some(applied) = &journal.applied {
            if applied.id == id {
                if applied.snapshot_sequence == snapshot_sequence {
                    return Ok(journal);
                }
                // Refresh the same physical store only under the host's exclusive
                // lifecycle lease. CAS revision guards late completion callbacks.
                if snapshot_sequence < applied.snapshot_sequence
                    || binding.staged.is_some()
                    || binding.active.as_ref().map(|active| active.id.as_str()) != Some(id)
                    || self.browser_capture_in_flight(root, profile)?
                {
                    return Err(Error::Identity);
                }
            }
        }
        if journal.revision != expected_revision {
            return Err(Error::Sequence);
        }
        let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
        document.validate()?;
        if document.sequence != snapshot_sequence || snapshot_sequence != self.applied_sequence()? {
            return Err(Error::Sequence);
        }
        let credentials = document
            .credentials
            .values()
            .filter(|record| record.profile_id == profile)
            .cloned()
            .collect();
        journal.pending = Some(BrowserImportReceipt {
            id: id.into(),
            snapshot_sequence,
            credentials,
        });
        journal.quarantined = false;
        self.save_browser_import(root, profile, expected_revision, journal)
    }

    /// The adapter must read back *all* target areas after awaited writes, with
    /// navigation/capture still suspended. A mismatch leaves the pending receipt
    /// intact. Expiry, missing HttpOnly cookies, or omitted storage cannot pass.
    pub fn finish_browser_import(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        expected_revision: u64,
        id: &str,
        observed: &[CredentialRecord],
    ) -> Result<BrowserImportJournal> {
        let mut journal = self.browser_import_journal(root, profile)?;
        if journal.quarantined {
            return Err(Error::Recovery);
        }
        if journal.pending.is_none() {
            if let Some(applied) = &journal.applied {
                if applied.id == id && equivalent(&applied.credentials, observed)? {
                    return Ok(journal);
                }
            }
        }
        let pending = journal.pending.as_ref().ok_or(Error::Recovery)?;
        if journal.revision != expected_revision || pending.id != id {
            return Err(Error::Sequence);
        }
        if !equivalent(&pending.credentials, observed)? {
            return Err(Error::Recovery);
        }
        journal.applied = journal.pending.take();
        self.save_browser_import(root, profile, expected_revision, journal)
    }

    /// A timed-out native callback may still mutate its old profile. Keep its
    /// receipt and block completion; a fresh process/profile recovery must prove
    /// outstanding native work is gone before restarting the restore.
    pub fn quarantine_browser_import(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        expected_revision: u64,
        id: &str,
    ) -> Result<BrowserImportJournal> {
        let mut journal = self.browser_import_journal(root, profile)?;
        if journal.revision != expected_revision
            || journal.pending.as_ref().map(|p| p.id.as_str()) != Some(id)
        {
            return Err(Error::Sequence);
        }
        journal.quarantined = true;
        self.save_browser_import(root, profile, expected_revision, journal)
    }

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

    pub(super) fn save_browser_import(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        previous_revision: u64,
        mut journal: BrowserImportJournal,
    ) -> Result<BrowserImportJournal> {
        journal.revision = previous_revision.checked_add(1).ok_or(Error::TooLarge)?;
        validate(profile, &journal)?;
        let bytes = Zeroizing::new(serde_json::to_vec(&journal)?);
        if bytes.len() > MAX_JOURNAL_BYTES {
            return Err(Error::TooLarge);
        }
        let encoded = serde_json::to_string(&root.seal_local(
            &self.scope,
            &self.grant.device_id,
            &record_key(profile, journal.revision),
            &bytes,
        )?)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<u64> = tx
            .query_row(
                "SELECT revision FROM sync_browser_imports WHERE profile_id=?1",
                [profile],
                |row| row.get(0),
            )
            .optional()?;
        if existing.unwrap_or(0) != previous_revision {
            return Err(Error::Sequence);
        }
        if existing.is_none() {
            let count: usize =
                tx.query_row("SELECT count(*) FROM sync_browser_imports", [], |row| {
                    row.get(0)
                })?;
            if count >= MAX_PROFILES {
                return Err(Error::TooLarge);
            }
        }
        tx.execute("INSERT INTO sync_browser_imports(profile_id,revision,journal) VALUES(?1,?2,?3)
            ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision,journal=excluded.journal",
            params![profile, journal.revision, encoded])?;
        tx.commit()?;
        Ok(journal)
    }
}
