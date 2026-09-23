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
    fn read_capture(&self, root: &VaultRoot, profile: &str) -> Result<Option<Capture>> {
        let row: Option<(u64, String)> = self
            .connection
            .query_row(
                "SELECT revision,observation FROM sync_browser_capture WHERE profile_id=?1",
                [profile],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((revision, encoded)) = row else {
            return Ok(None);
        };
        let bytes = root.open_local(
            &self.scope,
            &self.grant.device_id,
            &key(profile, revision),
            &serde_json::from_str(&encoded)?,
        )?;
        let capture: Capture = serde_json::from_slice(&bytes)?;
        if capture.revision != revision || revision > MAX_COUNTER || !valid_id(&capture.generation)
        {
            return Err(Error::Identity);
        }
        validate_observation(profile, &capture.observed)?;
        for v in &capture.baseline {
            if v.profile_id != profile {
                return Err(Error::Identity);
            }
            v.area.key(profile)?;
            v.area.validate_payload(&v.payload)?;
        }
        if let Some(pending) = &capture.pending {
            if !valid_id(&pending.id) || pending.batch.profile_id != profile {
                return Err(Error::Identity);
            }
            pending.batch.validate()?;
        }
        Ok(Some(capture))
    }
    fn save_capture(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        capture: &mut Capture,
    ) -> Result<()> {
        let previous = capture.revision;
        let revision = previous
            .checked_add(1)
            .filter(|v| *v <= MAX_COUNTER)
            .ok_or(Error::TooLarge)?;
        let mut next = capture.clone();
        next.revision = revision;
        let bytes = Zeroizing::new(serde_json::to_vec(&next)?);
        if bytes.len() > 16 << 20 {
            return Err(Error::TooLarge);
        }
        let encrypted = serde_json::to_string(&root.seal_local(
            &self.scope,
            &self.grant.device_id,
            &key(profile, revision),
            &bytes,
        )?)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actual: Option<u64> = tx
            .query_row(
                "SELECT revision FROM sync_browser_capture WHERE profile_id=?1",
                [profile],
                |r| r.get(0),
            )
            .optional()?;
        if actual.unwrap_or(0) != previous {
            return Err(Error::Sequence);
        }
        if actual.is_none()
            && tx.query_row("SELECT count(*) FROM sync_browser_capture", [], |r| {
                r.get::<_, u64>(0)
            })? >= 64
        {
            return Err(Error::TooLarge);
        }
        tx.execute("INSERT INTO sync_browser_capture VALUES(?1,?2,?3) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision, observation=excluded.observation", params![profile,revision,encrypted])?;
        tx.commit()?;
        *capture = next;
        Ok(())
    }

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
            capture.generation != generation
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

    fn pump_capture(
        &mut self,
        root: &VaultRoot,
        device: &DeviceKey,
        profile: &str,
        capture: &mut Capture,
    ) -> Result<BrowserCaptureState> {
        let binding = self.browser_profile_binding(root, profile)?;
        let journal = self.browser_import_journal(root, profile)?;
        if binding.staged.is_some()
            || journal.pending.is_some()
            || journal.quarantined
            || binding.active.as_ref().map(|v| &v.id) != Some(&capture.generation)
        {
            return Ok(BrowserCaptureState::NeedsImport);
        }
        let document: Document = serde_json::from_slice(&self.committed_snapshot(root)?)?;
        document.validate()?;
        let target = current(&document, profile);
        if let Some(pending) = &capture.pending {
            let applied: Option<u64> = self
                .connection
                .query_row(
                    "SELECT sequence FROM sync_applied WHERE operation_id=?1",
                    [&pending.id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(sequence) = applied {
                let updates: Vec<_> = pending
                    .batch
                    .updates
                    .iter()
                    .map(|v| CredentialRecord {
                        sequence,
                        profile_id: profile.into(),
                        area: v.area.clone(),
                        payload: v.payload.clone(),
                    })
                    .collect();
                let mut expected = capture.baseline.clone();
                for update in updates {
                    let key = update.area.key(profile)?;
                    expected.retain(|old| old.area.key(profile).ok().as_ref() != Some(&key));
                    expected.push(update);
                }
                if browser_import::equivalent(&expected, &target)? {
                    capture.baseline = target.clone();
                }
                capture.pending = None;
                self.save_capture(root, profile, capture)?;
                // A stale/superseded operation must never be rebased onto newer
                // remote credentials. Keep the observation for recovery.
                if !browser_import::equivalent(&capture.baseline, &target)? {
                    return Ok(BrowserCaptureState::NeedsImport);
                }
            } else {
                self.enqueue_capture(root, device, pending)?;
                return Ok(BrowserCaptureState::Queued);
            }
        }
        if !browser_import::equivalent(&capture.baseline, &target)? {
            return Ok(BrowserCaptureState::NeedsImport);
        }
        let desired = records(profile, &capture.observed, &capture.baseline)?;
        if browser_import::equivalent(&desired, &capture.baseline)? {
            return Ok(BrowserCaptureState::Clean);
        }
        let batch = Batch {
            profile_id: profile.into(),
            updates: desired
                .into_iter()
                .filter(|record| {
                    !capture.baseline.iter().any(|old| {
                        browser_import::equivalent(
                            std::slice::from_ref(old),
                            std::slice::from_ref(record),
                        )
                        .unwrap_or(false)
                    })
                })
                .map(|v| AreaUpdate {
                    area: v.area,
                    base_sequence: v.sequence,
                    payload: v.payload,
                })
                .collect(),
        };
        batch.validate()?;
        capture.pending = Some(Pending {
            id: uuid::Uuid::new_v4().to_string(),
            batch,
        });
        // Persist the stable intent ID and exact bytes before enqueue. Recovery
        // can complete either side of this boundary without another counter.
        self.save_capture(root, profile, capture)?;
        self.enqueue_capture(
            root,
            device,
            capture.pending.as_ref().ok_or(Error::Recovery)?,
        )?;
        Ok(BrowserCaptureState::Queued)
    }
    fn enqueue_capture(
        &mut self,
        root: &VaultRoot,
        device: &DeviceKey,
        pending: &Pending,
    ) -> Result<()> {
        let bytes = Zeroizing::new(serde_json::to_vec(&Payload::Credentials {
            version: 1,
            batch: pending.batch.clone(),
        })?);
        if bytes.len() > MAX_EVENT_BYTES - 16 {
            return Err(Error::TooLarge);
        }
        match self.enqueue_identified(root, device, &pending.id, &bytes) {
            Ok(_) => Ok(()),
            // The encrypted capture intent remains queued locally while the
            // bounded transport outbox drains. Never discard newer observations.
            Err(Error::TooLarge) => Ok(()),
            Err(error) => Err(error),
        }
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
