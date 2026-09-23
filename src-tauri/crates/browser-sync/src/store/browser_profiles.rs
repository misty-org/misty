//! Device-local logical/physical browser profile mapping. Physical identities
//! are native-generated and encrypted; no renderer-supplied path is accepted.
use super::{browser_import, Store};
use crate::{
    crypto::VaultRoot,
    document::{entities, Document},
    protocol::{valid_id, MAX_COUNTER},
    Error, Result,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use zeroize::Zeroizing;

const MAX_PROFILES: usize = 64;
const MAX_RETIRED: usize = 256;
const MAX_BYTES: usize = 256 << 10;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserGeneration {
    /// Also the import receipt identity. Not the physical browser store ID.
    pub id: String,
    pub physical_id: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserProfileBinding {
    pub revision: u64,
    pub active: Option<BrowserGeneration>,
    pub staged: Option<BrowserGeneration>,
    /// Retired stores remain recoverable until the native host has closed every
    /// client, awaited engine removal, and acknowledged that exact generation.
    pub retired: Vec<BrowserGeneration>,
}
fn key(profile: &str, revision: u64) -> String {
    format!("browser-profile:v1:{profile}:{revision}")
}
fn validate(profile: &str, binding: &BrowserProfileBinding) -> Result<()> {
    if !entities::profile_id(profile)
        || binding.revision > MAX_COUNTER
        || binding.retired.len() > MAX_RETIRED
    {
        return Err(Error::Invalid);
    }
    let mut ids = BTreeSet::new();
    let mut physical = BTreeSet::new();
    for generation in binding
        .active
        .iter()
        .chain(binding.staged.iter())
        .chain(binding.retired.iter())
    {
        if !valid_id(&generation.id)
            || !entities::profile_id(&generation.physical_id)
            || generation.physical_id == profile
            || !ids.insert(&generation.id)
            || !physical.insert(&generation.physical_id)
        {
            return Err(Error::Identity);
        }
    }
    Ok(())
}

impl Store {
    pub fn browser_profile_binding(
        &self,
        root: &VaultRoot,
        profile: &str,
    ) -> Result<BrowserProfileBinding> {
        if !entities::profile_id(profile) {
            return Err(Error::Invalid);
        }
        let row: Option<(u64, String)> = self
            .connection
            .query_row(
                "SELECT revision,binding FROM sync_browser_profiles WHERE profile_id=?1",
                [profile],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((revision, encrypted)) = row else {
            return Ok(BrowserProfileBinding::default());
        };
        if encrypted.len() > MAX_BYTES * 2 {
            return Err(Error::TooLarge);
        }
        let bytes = root.open_local(
            &self.scope,
            &self.grant.device_id,
            &key(profile, revision),
            &serde_json::from_str(&encrypted)?,
        )?;
        let binding: BrowserProfileBinding = serde_json::from_slice(&bytes)?;
        if binding.revision != revision {
            return Err(Error::Identity);
        }
        validate(profile, &binding)?;
        Ok(binding)
    }

    /// A retry with the same request ID reuses its allocated stage. To abandon
    /// uncertain native work, use a new request ID and the latest revision; the
    /// old physical store is retired and can never become the new stage.
    pub fn stage_browser_profile(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        expected_revision: u64,
        request_id: &str,
    ) -> Result<BrowserProfileBinding> {
        if !valid_id(request_id) {
            return Err(Error::Invalid);
        }
        if self.browser_capture_in_flight(root, profile)? {
            return Err(Error::Recovery);
        }
        let mut binding = self.browser_profile_binding(root, profile)?;
        if binding
            .staged
            .as_ref()
            .is_some_and(|generation| generation.id == request_id)
        {
            return Ok(binding);
        }
        if binding
            .active
            .as_ref()
            .is_some_and(|generation| generation.id == request_id)
            || binding
                .retired
                .iter()
                .any(|generation| generation.id == request_id)
        {
            return Err(Error::Identity);
        }
        if binding.revision != expected_revision {
            return Err(Error::Sequence);
        }
        if let Some(previous) = binding.staged.take() {
            if binding.retired.len() >= MAX_RETIRED {
                return Err(Error::TooLarge);
            }
            binding.retired.push(previous);
        }
        let physical_id = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        binding.staged = Some(BrowserGeneration {
            id: request_id.into(),
            physical_id,
        });
        let mut journal = self.browser_import_journal(root, profile)?;
        if journal
            .applied
            .iter()
            .chain(journal.pending.iter())
            .any(|receipt| receipt.id == request_id)
        {
            return Err(Error::Identity);
        }
        // Invalidate old receipt/attempt callbacks atomically with selecting the
        // fresh physical store. Keep the last verified receipt for recovery.
        let replacement = if journal.pending.take().is_some() {
            journal.quarantined = false;
            let previous = journal.revision;
            journal.revision = previous.checked_add(1).ok_or(Error::TooLarge)?;
            browser_import::validate(profile, &journal)?;
            let bytes = Zeroizing::new(serde_json::to_vec(&journal)?);
            let encrypted = serde_json::to_string(&root.seal_local(
                &self.scope,
                &self.grant.device_id,
                &browser_import::record_key(profile, journal.revision),
                &bytes,
            )?)?;
            Some((previous, journal.revision, encrypted))
        } else {
            None
        };
        self.save_browser_profile(root, profile, expected_revision, binding, replacement)
    }

    /// Activation is a compare-and-swap guarded by the complete native receipt
    /// and current committed credentials. Workspace-only events need no rewrite;
    /// a newer rotation/logout must be restored before this stage can activate.
    pub fn activate_browser_profile(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        expected_revision: u64,
        generation_id: &str,
    ) -> Result<BrowserProfileBinding> {
        let mut binding = self.browser_profile_binding(root, profile)?;
        let journal = self.browser_import_journal(root, profile)?;
        if journal.pending.is_some() || journal.quarantined {
            return Err(Error::Recovery);
        }
        let receipt = journal.applied.as_ref().ok_or(Error::Recovery)?;
        if receipt.id != generation_id {
            return Err(Error::Identity);
        }
        let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
        document.validate()?;
        let current: Vec<_> = document
            .credentials
            .values()
            .filter(|record| record.profile_id == profile)
            .cloned()
            .collect();
        if !browser_import::equivalent(&receipt.credentials, &current)? {
            return Err(Error::Recovery);
        }
        if binding.staged.is_none()
            && binding
                .active
                .as_ref()
                .is_some_and(|generation| generation.id == generation_id)
        {
            return Ok(binding);
        }
        if binding.revision != expected_revision {
            return Err(Error::Sequence);
        }
        if binding
            .staged
            .as_ref()
            .map(|generation| generation.id.as_str())
            != Some(generation_id)
        {
            return Err(Error::Identity);
        }
        if let Some(previous) = binding.active.take() {
            if binding.retired.len() >= MAX_RETIRED {
                return Err(Error::TooLarge);
            }
            binding.retired.push(previous);
        }
        binding.active = binding.staged.take();
        self.save_browser_profile(root, profile, expected_revision, binding, None)
    }

    /// Call only after the native engine confirms removal of this retired store
    /// and no browser/capture lease can still use it. Active/staged stores reject.
    pub fn forget_retired_browser_profile(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        expected_revision: u64,
        generation_id: &str,
    ) -> Result<BrowserProfileBinding> {
        let mut binding = self.browser_profile_binding(root, profile)?;
        if binding
            .active
            .iter()
            .chain(binding.staged.iter())
            .any(|generation| generation.id == generation_id)
        {
            return Err(Error::Identity);
        }
        if !binding
            .retired
            .iter()
            .any(|generation| generation.id == generation_id)
        {
            return Ok(binding);
        }
        if binding.revision != expected_revision {
            return Err(Error::Sequence);
        }
        binding
            .retired
            .retain(|generation| generation.id != generation_id);
        self.save_browser_profile(root, profile, expected_revision, binding, None)
    }

    pub fn browser_profiles_staged(&self, root: &VaultRoot) -> Result<bool> {
        let mut query = self
            .connection
            .prepare("SELECT profile_id FROM sync_browser_profiles LIMIT 65")?;
        let profiles: Vec<String> = query
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        if profiles.len() > MAX_PROFILES {
            return Err(Error::TooLarge);
        }
        let mut staged = false;
        for profile in profiles {
            staged |= self
                .browser_profile_binding(root, &profile)?
                .staged
                .is_some();
        }
        Ok(staged)
    }

    fn save_browser_profile(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        previous_revision: u64,
        mut binding: BrowserProfileBinding,
        import_replacement: Option<(u64, u64, String)>,
    ) -> Result<BrowserProfileBinding> {
        binding.revision = previous_revision.checked_add(1).ok_or(Error::TooLarge)?;
        validate(profile, &binding)?;
        let bytes = Zeroizing::new(serde_json::to_vec(&binding)?);
        if bytes.len() > MAX_BYTES {
            return Err(Error::TooLarge);
        }
        let encrypted = serde_json::to_string(&root.seal_local(
            &self.scope,
            &self.grant.device_id,
            &key(profile, binding.revision),
            &bytes,
        )?)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<u64> = tx
            .query_row(
                "SELECT revision FROM sync_browser_profiles WHERE profile_id=?1",
                [profile],
                |row| row.get(0),
            )
            .optional()?;
        if existing.unwrap_or(0) != previous_revision {
            return Err(Error::Sequence);
        }
        if existing.is_none()
            && tx.query_row("SELECT count(*) FROM sync_browser_profiles", [], |row| {
                row.get::<_, usize>(0)
            })? >= MAX_PROFILES
        {
            return Err(Error::TooLarge);
        }
        if let Some((before, after, journal)) = import_replacement {
            if tx.execute("UPDATE sync_browser_imports SET revision=?1,journal=?2 WHERE profile_id=?3 AND revision=?4", params![after,journal,profile,before])? != 1 {return Err(Error::Sequence);}
        }
        tx.execute("INSERT INTO sync_browser_profiles(profile_id,revision,binding) VALUES(?1,?2,?3) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision,binding=excluded.binding", params![profile,binding.revision,encrypted])?;
        tx.commit()?;
        Ok(binding)
    }
}
