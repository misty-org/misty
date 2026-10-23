//! Reporting the worker's phase and keeping the device roster current.
use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(super) fn refresh_status(&self) -> Result<()> {
        let current = self.status.borrow().clone();
        self.report(current.phase, current.issue)
    }

    pub(super) fn report(&self, mut phase: Phase, issue: Option<&'static str>) -> Result<()> {
        let cursor = self.store.applied_sequence()?;
        let pending = self.store.pending_count()?;
        if matches!(phase, Phase::CatchingUp | Phase::Ready) {
            // Workspace-wide sign-in imports only exist before workspaces.
            // In workspace mode each device's sign-in data has its own state
            // (reported per device), and nothing advances the legacy import
            // bookkeeping, so waiting on it would never finish.
            let imports_settled = self.workspaces.workspace_mode()
                || (self
                    .imported_through
                    .is_some_and(|sequence| sequence >= cursor)
                    && !self.store.browser_imports_pending(&self.root)?
                    && !self.store.browser_profiles_staged(&self.root)?);
            phase = if imports_settled
                && !self.roster.is_empty()
                && cursor >= self.head
                && pending == 0
            {
                Phase::Ready
            } else {
                Phase::CatchingUp
            };
        }
        let next = Status {
            phase,
            applied_sequence: cursor,
            head_sequence: self.head,
            pending_changes: pending,
            issue,
        };
        // A failed command is not a state change. Notifying on every rejection
        // feeds the renderer's retry back into this same command indefinitely.
        self.status.send_if_modified(|current| {
            if *current == next {
                false
            } else {
                *current = next;
                true
            }
        });
        Ok(())
    }

    pub(super) fn update_roster(&mut self, devices: Vec<Device>) -> Result<()> {
        if devices.len() > 1024 {
            return Err(Error::TooLarge);
        }
        let enrolled = devices.clone();
        let mut roster = HashMap::new();
        let mut own = false;
        for device in devices {
            self.root.verify_grant(&self.scope, &device.grant)?;
            if device.last_counter > MAX_COUNTER {
                return Err(Error::Invalid);
            }
            if device.grant.device_id == self.store.grant().device_id {
                if device.revoked_at.is_some() {
                    return Err(Error::DeviceForbidden);
                }
                if device.grant.public_key != self.device.public_key()
                    || device.grant.key_epoch != self.store.grant().key_epoch
                {
                    return Err(Error::Identity);
                }
                if device.last_counter > self.store.allocated_counter()? {
                    return Err(Error::Recovery);
                }
                own = true;
            }
            if roster
                .insert(device.grant.device_id.clone(), device.grant)
                .is_some()
            {
                return Err(Error::Identity);
            }
        }
        if !own {
            return Err(Error::DeviceForbidden);
        }
        self.roster = roster;
        // A request is delivered through the existing authenticated roster.
        // The target signs its own takeover. The request ID makes replay and
        // reconnect idempotent; a stale request never wakes a returning device.
        if let Some(own) = enrolled
            .iter()
            .find(|d| d.grant.device_id == self.store.grant().device_id)
        {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            if self.workspaces.idle() {
                self.store
                    .resync_workspace_counter(own.workspace_last_counter)?;
            } else {
                self.store
                    .observe_workspace_counter(own.workspace_last_counter)?;
            }
            // Workspace protocol: the target signs a claim reusing the request ID,
            // which the server checks against the request's workspace and expiry.
            if own.full_sync && own.activation_expires_at > now {
                if let Some(request) = own.activation_request.as_deref().filter(|id| valid_id(id)) {
                    if self.claimed_requests.insert(request.to_owned()) {
                        let workspace = own
                            .activation_workspace_id
                            .clone()
                            .filter(|id| valid_id(id))
                            .unwrap_or_else(|| own.grant.device_id.clone());
                        let grant = self.store.grant().clone();
                        let frame = self.workspaces.claim(
                            &mut self.store,
                            &self.scope,
                            &grant,
                            &self.device,
                            &workspace,
                            Some(request.to_owned()),
                            None,
                        )?;
                        self.workspace_outbox.push(frame);
                    }
                }
            }
        }
        self.devices.send_replace(enrolled);
        self.refresh_shared_retirement()
    }
}
