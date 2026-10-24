//! The worker's outer loop: connecting, going dormant and backing off.
use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub async fn run(mut self) -> Result<()> {
        // This outer cancellation also covers an in-progress roster fetch or
        // socket write inside a frame handler. Lock must not wait for network I/O.
        let mut stop = self.stop.clone();
        let result = tokio::select! {
            biased;
            _ = stop.changed() => Ok(()),
            result = self.run_inner() => result,
        };
        if let Err(error) = &result {
            // The status only carries a code; keep the cause for diagnosis.
            // SQLite errors name the failing constraint or table, never values.
            let line = match error {
                Error::Storage(cause) => format!("browser sync stopped: {error}: {cause}"),
                _ => format!("browser sync stopped: {error}"),
            };
            eprintln!("{line}");
            let issue = match error {
                Error::Authentication => "sign_in_required",
                Error::DeviceForbidden => "sync_device_forbidden",
                Error::Identity | Error::Unlock => "vault_identity_failed",
                Error::Sequence => "replay_conflict",
                Error::Recovery => "checkpoint_or_key_recovery_required",
                Error::Storage(_) => "local_storage_unavailable",
                _ => "sync_protocol_failed",
            };
            let _ = self.report(Phase::Attention, Some(issue));
        } else {
            let _ = self.report(Phase::Stopped, None);
        }
        self.presence.send_replace(Vec::new());
        result
    }

    pub(super) async fn run_inner(&mut self) -> Result<()> {
        if self.local {
            return self.run_local().await;
        }
        let mut failures = 0u32;
        loop {
            if *self.stop.borrow() {
                return Ok(());
            }
            if !self.dormant().await? {
                return Ok(());
            }
            self.roster.clear();
            self.presence.send_replace(Vec::new());
            // A dormant vault's routine pull keeps showing its last state.
            if *self.live.borrow() || self.pulled_at.is_none() {
                self.report(Phase::Connecting, None)?;
            }
            // The attempt owns copies of only its signing identity. Local edits
            // can continue using the database while DNS/HTTP/socket setup waits.
            let api = self.api.clone();
            let scope = self.scope.clone();
            let grant = self.store.grant().clone();
            let device = self.device.clone();
            let public = self.root.public_key()?;
            let cursor = self.store.applied_sequence()?;
            let cached_vault = self.store.cached_vault()?;
            let attempt = async move {
                if let Some(cached) = cached_vault {
                    cached.ensure_enrolled(&api, &grant).await?;
                }
                SyncSocket::connect(&api, &scope, &grant, &device, &public, cursor).await
            };
            tokio::pin!(attempt);
            let connected = loop {
                tokio::select! {
                    biased;
                    _ = self.stop.changed() => return Ok(()),
                    command = self.commands.recv() => {
                        if !self.command(command)? { return Ok(()); }
                    },
                    result = &mut attempt => break result,
                }
            };
            let started = Instant::now();
            let result = match connected {
                Ok(mut socket) => {
                    if socket.vault.head_sequence < self.head {
                        return Err(Error::Recovery);
                    }
                    self.store.confirm_enrollment(&socket.vault)?;
                    self.store.observe_head(socket.vault.head_sequence)?;
                    self.head = self.head.max(socket.vault.head_sequence);
                    self.connected_now = true;
                    let result = self.connected(&mut socket).await;
                    self.connected_now = false;
                    self.workspaces_disconnected();
                    result
                }
                Err(error) => Err(error),
            };
            match result {
                Ok(()) if std::mem::take(&mut self.dormant_exit) => {
                    self.presence.send_replace(Vec::new());
                    continue;
                }
                Ok(()) => return Ok(()),
                Err(Error::Network) => {}
                Err(error) => return Err(error),
            }
            self.presence.send_replace(Vec::new());
            self.report(Phase::Offline, None)?;
            if started.elapsed() >= Duration::from_secs(30) {
                failures = 0;
            }
            failures = (failures + 1).min(5);
            let max_ms = (500u64 << failures).min(30_000);
            let delay = Duration::from_millis(rand::thread_rng().gen_range(max_ms / 2..=max_ms));
            let backoff = sleep(delay);
            tokio::pin!(backoff);
            loop {
                tokio::select! {
                    biased;
                    _ = self.stop.changed() => return Ok(()),
                    command = self.commands.recv() => {
                        if !self.command(command)? { return Ok(()); }
                    },
                    _ = &mut backoff => break,
                }
            }
        }
    }

    /// A local vault's loop: no server, so its collections are complete as they stand and
    /// every edit stays in its own database. Commands are answered until the worker stops.
    async fn run_local(&mut self) -> Result<()> {
        for collection in crate::collections::COLLECTIONS {
            let mut state = self.store.collection(&self.root, collection)?;
            if !state.loaded {
                state.loaded = true;
                self.store.set_collection(&self.root, collection, &state)?;
            }
        }
        self.report(Phase::Offline, None)?;
        loop {
            tokio::select! {
                biased;
                _ = self.stop.changed() => return Ok(()),
                command = self.commands.recv() => {
                    if !self.command(command)? { return Ok(()); }
                },
            }
        }
    }

    /// Waits while this vault is not live, has nothing to publish and pulled
    /// less than a pull interval ago. False when the worker stops meanwhile.
    pub(super) async fn dormant(&mut self) -> Result<bool> {
        loop {
            if *self.live.borrow() || self.store.pending_count()? > 0 {
                return Ok(true);
            }
            let Some(due) = self.pulled_at.map(|at| at + crate::batch::pull_interval()) else {
                return Ok(true);
            };
            if Instant::now() >= due {
                return Ok(true);
            }
            let wait = tokio::time::sleep_until(due);
            tokio::pin!(wait);
            tokio::select! {
                biased;
                _ = self.stop.changed() => return Ok(false),
                result = self.live.changed() => if result.is_err() { return Ok(true); },
                command = self.commands.recv() => { if !self.command(command)? { return Ok(false); } },
                _ = &mut wait => return Ok(true),
            }
        }
    }

    /// Not live, caught up and nothing left to send: time to disconnect.
    pub(super) fn settled_for_dormancy(&self, in_flight: bool) -> Result<bool> {
        Ok(!*self.live.borrow()
            && !in_flight
            && self.workspace_outbox.is_empty()
            && self.flushes.is_empty()
            && self.store.applied_sequence()? >= self.head
            && self.store.pending_count()? == 0)
    }
}
