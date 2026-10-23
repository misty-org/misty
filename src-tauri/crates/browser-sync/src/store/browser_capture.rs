//! Native observations are durable before acquiring an outbox counter. One
//! credential operation per profile is in flight; later observations coalesce
//! here, encrypted, until its ordered result establishes the next base version.
use super::{browser_import, BrowserImportReceipt, Store};
use crate::{
    crypto::{DeviceKey, VaultRoot},
    document::{
        credentials::{Area, AreaUpdate, Batch},
        CredentialRecord, Document, Payload,
    },
    protocol::{valid_id, MAX_COUNTER, MAX_EVENT_BYTES},
    Error, Result,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

mod persist;
mod pump;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserObservation {
    pub area: Area,
    pub payload: serde_json::Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BrowserCaptureState {
    Clean,
    Queued,
    NeedsImport,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    id: String,
    batch: Batch,
    #[serde(default)]
    active_epoch: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Capture {
    revision: u64,
    generation: String,
    #[serde(default)]
    imported_sequence: u64,
    baseline: Vec<CredentialRecord>,
    observed: Vec<BrowserObservation>,
    pending: Option<Pending>,
    #[serde(default)]
    active_epoch: Option<String>,
}
fn key(profile: &str, revision: u64) -> String {
    format!("browser-capture:v1:{profile}:{revision}")
}
fn validate_observation(profile: &str, observed: &[BrowserObservation]) -> Result<()> {
    let batch = Batch {
        profile_id: profile.into(),
        updates: observed
            .iter()
            .map(|v| AreaUpdate {
                area: v.area.clone(),
                base_sequence: MAX_COUNTER,
                payload: v.payload.clone(),
            })
            .collect(),
    };
    batch.validate()?;
    // Bound the actual wire form at the largest possible base sequence before
    // saving an intent, not just the smaller native observation representation.
    if serde_json::to_vec(&Payload::Credentials { version: 1, batch })?.len() > MAX_EVENT_BYTES - 16
    {
        return Err(Error::TooLarge);
    }
    Ok(())
}

fn records(
    profile: &str,
    observed: &[BrowserObservation],
    baseline: &[CredentialRecord],
) -> Result<Vec<CredentialRecord>> {
    let bases: BTreeMap<_, _> = baseline
        .iter()
        .map(|v| Ok((v.area.key(profile)?, v.sequence)))
        .collect::<Result<_>>()?;
    observed
        .iter()
        .map(|v| {
            Ok(CredentialRecord {
                profile_id: profile.into(),
                area: v.area.clone(),
                sequence: *bases.get(&v.area.key(profile)?).unwrap_or(&0),
                payload: v.payload.clone(),
            })
        })
        .collect()
}
fn current(document: &Document, profile: &str) -> Vec<CredentialRecord> {
    document
        .credentials
        .values()
        .filter(|v| v.profile_id == profile)
        .cloned()
        .collect()
}

impl Store {
    /// Only a native reader holding the host's account/profile lifetime may call
    /// this. Complete area snapshots include explicit empty values for logout.
    pub fn observe_browser_profile(
        &mut self,
        root: &VaultRoot,
        device: &DeviceKey,
        profile: &str,
        generation: &str,
        observed: Vec<BrowserObservation>,
    ) -> Result<BrowserCaptureState> {
        validate_observation(profile, &observed)?;
        let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
        if document.active_device.is_some() && !document.is_active(&self.grant.device_id) {
            return Err(Error::InactiveDevice);
        }
        let epoch = document.active_device.as_ref().map(|v| v.epoch.clone());
        let binding = self.browser_profile_binding(root, profile)?;
        let journal = self.browser_import_journal(root, profile)?;
        if binding.staged.is_some() || journal.pending.is_some() || journal.quarantined {
            return Err(Error::Recovery);
        }
        if binding.active.as_ref().map(|v| v.id.as_str()) != Some(generation) {
            return Err(Error::Identity);
        }
        let applied = journal
            .applied
            .as_ref()
            .filter(|v| v.id == generation)
            .ok_or(Error::Recovery)?;
        let previous = self.read_capture(root, profile)?;
        let reset = previous.as_ref().is_none_or(|capture| {
            capture.active_epoch != epoch
                || capture.generation != generation
                || (capture.imported_sequence < applied.snapshot_sequence
                    && !browser_import::equivalent(&capture.baseline, &applied.credentials)
                        .unwrap_or(false))
        });
        let mut capture = match previous {
            Some(capture) if !reset => capture,
            previous => {
                // Replay may commit an acknowledgment just before the process
                // stops, before capture bookkeeping clears its pending ID.
                // A verified replacement generation can discard that resolved
                // intent, but never an operation whose outcome is unknown.
                if self.browser_capture_in_flight(root, profile)? {
                    return Err(Error::Recovery);
                }
                Capture {
                    revision: previous.map_or(0, |v| v.revision),
                    generation: generation.into(),
                    imported_sequence: applied.snapshot_sequence,
                    baseline: applied.credentials.clone(),
                    observed: observed.clone(),
                    pending: None,
                    active_epoch: epoch.clone(),
                }
            }
        };
        // Missing coverage is unsupported capture, never an implicit deletion.
        let keys: std::collections::BTreeSet<_> = observed
            .iter()
            .map(|v| v.area.key(profile))
            .collect::<Result<_>>()?;
        if capture
            .baseline
            .iter()
            .any(|v| v.area.key(profile).is_ok_and(|key| !keys.contains(&key)))
        {
            return Err(Error::Recovery);
        }
        let changed = !browser_import::equivalent(
            &records(profile, &capture.observed, &capture.baseline)?,
            &records(profile, &observed, &capture.baseline)?,
        )?;
        capture.observed = observed;
        if reset || changed {
            self.save_capture(root, profile, &mut capture)?;
        }
        let state = self.pump_capture(root, device, profile, &mut capture)?;
        if state == BrowserCaptureState::Clean {
            // This confirmation uses this call's fresh native observation, not
            // the last queued payload or an acknowledgment from the server.
            let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
            let target = current(&document, profile);
            let actual = records(profile, &capture.observed, &target)?;
            if !browser_import::equivalent(&actual, &target)? {
                return Err(Error::Recovery);
            }
            let mut journal = self.browser_import_journal(root, profile)?;
            if journal.applied.as_ref().is_none_or(|v| {
                !browser_import::equivalent(&v.credentials, &actual).unwrap_or(false)
            }) {
                let previous = journal.revision;
                journal.applied = Some(BrowserImportReceipt {
                    id: generation.into(),
                    snapshot_sequence: document.sequence,
                    credentials: actual,
                });
                self.save_browser_import(root, profile, previous, journal)?;
            }
        }
        Ok(state)
    }

    pub(super) fn browser_capture_in_flight(
        &self,
        root: &VaultRoot,
        profile: &str,
    ) -> Result<bool> {
        let Some(capture) = self.read_capture(root, profile)? else {
            return Ok(false);
        };
        let Some(pending) = capture.pending else {
            return Ok(false);
        };
        if self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_discarded WHERE operation_id=?1)",
            [&pending.id],
            |r| r.get::<_, bool>(0),
        )? {
            return Ok(false);
        }
        let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
        if pending.active_epoch != document.active_device.as_ref().map(|v| v.epoch.clone()) {
            return Ok(false);
        }
        Ok(self
            .connection
            .query_row(
                "SELECT sequence FROM sync_applied WHERE operation_id=?1",
                [&pending.id],
                |row| row.get::<_, u64>(0),
            )
            .optional()?
            .is_none())
    }
    pub fn resume_browser_captures(&mut self, root: &VaultRoot, device: &DeviceKey) -> Result<()> {
        let profiles: Vec<String> = {
            let mut statement = self
                .connection
                .prepare("SELECT profile_id FROM sync_browser_capture LIMIT 65")?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        if profiles.len() > 64 {
            return Err(Error::TooLarge);
        }
        for profile in profiles {
            if let Some(mut capture) = self.read_capture(root, &profile)? {
                self.pump_capture(root, device, &profile, &mut capture)?;
            }
        }
        Ok(())
    }
}
