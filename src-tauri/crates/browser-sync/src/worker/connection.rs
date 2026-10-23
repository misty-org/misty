//! The worker while its socket is open: catching up, then publishing the
//! outbox and applying what the server sends.
use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(super) async fn connected(&mut self, socket: &mut SyncSocket) -> Result<()> {
        self.report(Phase::CatchingUp, None)?;
        self.workspaces_connected(socket).await?;
        let mut tick = interval(Duration::from_millis(250));
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut heartbeat = interval(Duration::from_secs(15));
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut in_flight: Option<(String, Instant)> = None;
        let mut gap_retries = 0u8;
        // Liveness is the transport: the server pings and this socket answers.
        // A heartbeat frame only reports a changed cursor, readiness or active
        // epoch, so an idle, caught-up device sends nothing.
        let mut reported: Option<(u64, bool, Option<String>)> = None;
        loop {
            tokio::select! {
                biased;
                _ = self.stop.changed() => return Ok(()),
                command = self.commands.recv() => { if !self.command(command)? { return Ok(()); } },
                frame = socket.receive() => {
                    match frame? {
                        ServerFrame::Devices { devices } => self.update_roster(devices)?,
                        ServerFrame::Presence { devices } => {
                            if devices.len() > 1024 || devices.iter().any(|d| !valid_id(&d.device_id) || d.applied_sequence > MAX_COUNTER) { return Err(Error::Invalid); }
                            self.presence.send_replace(devices);
                        },
                        ServerFrame::Ack { receipt } => {
                            self.store.acknowledge(&receipt)?;
                            self.head = self.head.max(receipt.sequence);
                            if in_flight.as_ref().is_some_and(|(id, _)| *id == receipt.operation_id) { in_flight = None; }
                        },
                        ServerFrame::Events { replay } => {
                            if replay.checkpoint_required { return Err(Error::Recovery); }
                            if replay.head_sequence > MAX_COUNTER || replay.events.is_empty() || replay.events.len() > 200
                                || replay.events.iter().any(|e| e.sequence > replay.head_sequence) { return Err(Error::Invalid); }
                            self.store.observe_head(replay.head_sequence)?;
                            self.head = self.head.max(replay.head_sequence);
                            let before = self.store.applied_sequence()?;
                            let mut expected = before + 1;
                            let mut gap = false;
                            for event in &replay.events {
                                if event.sequence > expected { gap = true; break; }
                                if event.sequence == expected { expected += 1; }
                            }
                            if gap {
                                gap_retries += 1;
                                if gap_retries > 3 { return Err(Error::Sequence); }
                                socket.send(&ClientFrame::Resume { after: before }).await?;
                                self.report(Phase::CatchingUp, None)?;
                                continue;
                            }
                            if replay.events.iter().any(|e| !self.roster.contains_key(&e.mutation.device_id)) {
                                self.update_roster(self.api.devices().await?)?;
                            }
                            let page = replay.events.into_iter().map(|event| {
                                let grant = self.roster.get(&event.mutation.device_id).ok_or(Error::Identity)?.clone();
                                Ok((event, grant))
                            }).collect::<Result<Vec<_>>>()?;
                            let applied = self.store.apply_events(&self.root, &page, &mut self.reduce)?;
                            self.store.resume_browser_captures(&self.root, &self.device)?;
                            if applied > before { gap_retries = 0; }
                            self.head = self.head.max(replay.head_sequence);
                            if in_flight.as_ref().is_some_and(|(id, _)| page.iter().any(|(e, _)| e.mutation.operation_id == *id)) { in_flight = None; }
                        },
                        ServerFrame::AccountEvent { event } => {
                            if event.topic == "browser-records" {
                                match event.id.as_deref() {
                                    Some(crate::collections::CLIPBOARD) => self.clipboard.hinted(),
                                    Some(collection) => self.collections.hinted(collection),
                                    None => {}
                                }
                            } else if event.topic == "reset" {
                                self.collections.reset();
                                self.clipboard.hinted();
                            }
                            let _ = self.events.send(event);
                        },
                        ServerFrame::Workspaces { workspaces } => self.workspace_roster(socket, workspaces).await?,
                        ServerFrame::WorkspaceDelta { delta } => {
                            let workspace = delta.workspace_id.clone();
                            let result = self.workspace_delta(socket, delta).await;
                            self.workspace_verified(&workspace, result)?
                        },
                        ServerFrame::WorkspaceSnapshot { snapshot } => {
                            let workspace = snapshot.workspace_id.clone();
                            let result = self.workspace_snapshot(snapshot).await;
                            self.workspace_verified(&workspace, result)?
                        },
                        ServerFrame::WorkspaceCurrent { workspace_id, version } => self.workspace_current(socket, &workspace_id, version).await?,
                        ServerFrame::WorkspaceAck { request_id, receipt } => self.workspace_ack(request_id.as_deref(), receipt)?,
                        ServerFrame::WorkspaceError { code, request_id, operation_id, retry_after_ms, .. } => self.workspace_error(request_id.as_deref(), operation_id.as_deref(), &code, retry_after_ms.map(Duration::from_millis))?,
                        ServerFrame::BatchPolicy { policy } => self.batch_policy(&policy),
                        ServerFrame::Slot { request_id, slot } => self.workspaces.on_slot(&self.root, &self.scope, request_id.as_deref(), slot),
                        ServerFrame::Blobs { .. } | ServerFrame::BlobAck { .. } => {},
                        ServerFrame::Records { request_id, listing } => {
                            if self.clipboard.listing(request_id.as_deref(), &listing).is_some() {
                                self.publish_clipboard_rows();
                            } else {
                                self.records_listing(request_id.as_deref(), listing)?
                            }
                        },
                        ServerFrame::RecordsAck { request_id, results, .. } => {
                            if self.clipboard.ack(request_id.as_deref(), &results).is_some() {
                                self.publish_clipboard_rows();
                            } else {
                                self.records_ack(request_id.as_deref(), results)?
                            }
                        },
                        ServerFrame::CheckpointRequired { .. } => return Err(Error::Recovery),
                        ServerFrame::Error { code, .. } if code == "sync_unavailable" => return Err(Error::Network),
                        ServerFrame::Error { code, .. } if code == "sync_device_forbidden" => return Err(Error::DeviceForbidden),
                        ServerFrame::Error { .. } => return Err(Error::Recovery),
                        _ => return Err(Error::Invalid),
                    }
                    self.report(Phase::CatchingUp, None)?;
                },
                _ = heartbeat.tick() => {
                    let status = self.status.borrow().clone();
                    let document = serde_json::from_slice::<crate::document::Document>(&self.store.committed_snapshot(&self.root)?).ok();
                    let active_epoch = document.as_ref().filter(|v| !v.workspace_mode && v.is_active(&self.store.grant().device_id))
                        .and_then(|v| v.active_device.as_ref()).map(|v| v.epoch.clone());
                    let current = (status.applied_sequence, status.phase == Phase::Ready, active_epoch);
                    if reported.as_ref() != Some(&current) {
                        socket.send(&ClientFrame::Heartbeat { applied_sequence: current.0, ready: current.1, active_epoch: current.2.as_deref(), activation: None }).await?;
                        reported = Some(current);
                    }
                },
                _ = tick.tick() => {
                    if socket.stale() || in_flight.as_ref().is_some_and(|(_, sent)| sent.elapsed() >= Duration::from_secs(20)) { return Err(Error::Network); }
                    self.workspace_tick(socket).await?;
                    self.records_tick(socket).await?;
                    self.clipboard_tick(socket).await?;
                    self.settle_flushes()?;
                    if self.settled_for_dormancy(in_flight.is_some())? {
                        self.pulled_at = Some(Instant::now());
                        self.dormant_exit = true;
                        return Ok(());
                    }
                    // Catch up before publishing offline credentials; the reducer
                    // will enforce their base-version preconditions atomically.
                    if in_flight.is_none() && self.devices.borrow().iter().any(|d| d.grant.device_id == self.store.grant().device_id && d.full_sync) && !self.roster.is_empty() && self.store.applied_sequence()? >= self.head {
                        if let Some(mutation) = self.store.pending(true, 1)?.into_iter().next() {
                            let bytes = self.root.open_mutation(&self.scope, self.store.grant(), &mutation)?;
                            let payload = serde_json::from_slice::<crate::document::Payload>(&bytes).ok();
                            let status = self.status.borrow().clone();
                            socket.send(&publication_frame(&mutation, payload.as_ref(), &status)).await?;
                            in_flight = Some((mutation.operation_id, Instant::now()));
                        }
                    }
                },
            }
        }
    }
}

fn publication_frame<'a>(
    mutation: &'a Mutation,
    payload: Option<&'a crate::document::Payload>,
    status: &Status,
) -> ClientFrame<'a> {
    use crate::document::Payload;
    match payload {
        Some(Payload::ActiveDevice { active: true, .. }) => ClientFrame::Heartbeat {
            applied_sequence: status.applied_sequence,
            ready: status.phase == Phase::Ready,
            active_epoch: None,
            activation: Some(mutation),
        },
        Some(Payload::Published { active_epoch, .. }) => ClientFrame::Publish {
            mutation,
            active_epoch: Some(active_epoch),
        },
        _ => ClientFrame::Publish {
            mutation,
            active_epoch: None,
        },
    }
}
