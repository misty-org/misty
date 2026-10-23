//! Turning coalesced observations into ordered credential operations.
use super::*;

impl Store {
    pub(super) fn pump_capture(
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
        if document.active_device.is_some() && !document.is_active(&self.grant.device_id) {
            return Ok(BrowserCaptureState::Clean);
        }
        if capture.active_epoch != document.active_device.as_ref().map(|v| v.epoch.clone()) {
            return Ok(BrowserCaptureState::NeedsImport);
        }
        let target = current(&document, profile);
        if let Some(pending) = &capture.pending {
            let discarded: bool = self.connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_discarded WHERE operation_id=?1)",
                [&pending.id],
                |r| r.get(0),
            )?;
            if discarded {
                capture.pending = None;
                self.save_capture(root, profile, capture)?;
                return Ok(BrowserCaptureState::NeedsImport);
            }
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
            active_epoch: capture.active_epoch.clone(),
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
    pub(super) fn enqueue_capture(
        &mut self,
        root: &VaultRoot,
        device: &DeviceKey,
        pending: &Pending,
    ) -> Result<()> {
        let payload = Payload::Credentials {
            version: 1,
            batch: pending.batch.clone(),
        };
        let payload = match &pending.active_epoch {
            Some(epoch) => payload.published(epoch.clone()),
            None => payload,
        };
        let bytes = Zeroizing::new(serde_json::to_vec(&payload)?);
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
}
