//! Staging, activating and retiring physical browser profiles.
use super::*;

impl Store {
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
}
