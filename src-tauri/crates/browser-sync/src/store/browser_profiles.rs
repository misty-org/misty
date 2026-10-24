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

mod lifecycle;

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
