//! Applying one command to the worker's state.

use super::*;

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(super) fn command(&mut self, command: Option<Command>) -> Result<bool> {
        let Some(command) = command else {
            return Ok(false);
        };
        match command {
            Command::BrowserUnverified(reply) => {
                self.imported_through = None;
                let result = self.refresh_status();
                let _ = reply.send(result);
            }
            Command::ObserveBrowser(profile, generation, observed, reply) => {
                let result = self.store.observe_browser_profile(
                    &self.root,
                    &self.device,
                    &profile,
                    &generation,
                    observed,
                );
                if !matches!(result, Ok(BrowserCaptureState::Clean)) {
                    self.imported_through = None;
                }
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::ReadBrowserProfile(profile, reply) => {
                let _ = reply.send(self.store.browser_profile_binding(&self.root, &profile));
            }
            Command::StageBrowserProfile(profile, revision, id, reply) => {
                let result = self
                    .store
                    .stage_browser_profile(&self.root, &profile, revision, &id);
                if result.is_ok() {
                    self.imported_through = None;
                }
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::ActivateBrowserProfile(profile, revision, id, reply) => {
                let result = self
                    .store
                    .activate_browser_profile(&self.root, &profile, revision, &id);
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::ForgetBrowserProfile(profile, revision, id, reply) => {
                let _ = reply.send(
                    self.store
                        .forget_retired_browser_profile(&self.root, &profile, revision, &id),
                );
            }
            Command::ReadBrowserImport(profile, reply) => {
                let _ = reply.send(self.store.browser_import_journal(&self.root, &profile));
            }
            Command::BeginBrowserImport(profile, revision, id, sequence, reply) => {
                let result = self
                    .store
                    .begin_browser_import(&self.root, &profile, revision, &id, sequence);
                if result.is_ok() {
                    self.imported_through = None;
                }
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::FinishBrowserImport(profile, revision, id, observed, reply) => {
                let result = self
                    .store
                    .finish_browser_import(&self.root, &profile, revision, &id, &observed);
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::QuarantineBrowserImport(profile, revision, id, reply) => {
                let result = self
                    .store
                    .quarantine_browser_import(&self.root, &profile, revision, &id);
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::WorkspaceChanges(changes, reply) => {
                // Bookmarks go to their collection; the rest to the workspace.
                let changes = self.gate_pinned_tabs(changes);
                let result = self.route_record_changes(changes).and_then(|rest| {
                    if rest.is_empty() {
                        Ok(())
                    } else {
                        self.workspaces
                            .apply_changes(&mut self.store, &self.root, rest)
                    }
                });
                let _ = reply.send(result);
                self.publish_sync_state()?;
            }
            Command::WorkspaceSlotWrite(tab, slot, plaintext, reply) => {
                let _ = reply.send(self.workspaces.write_slot(
                    &mut self.store,
                    &self.root,
                    &tab,
                    slot,
                    plaintext,
                ));
            }
            Command::WorkspaceClaim(workspace, reply) => {
                if !self.connected_now {
                    let _ = reply.send(Err(Error::Network));
                } else {
                    let grant = self.store.grant().clone();
                    match self.workspaces.claim(
                        &mut self.store,
                        &self.scope,
                        &grant,
                        &self.device,
                        &workspace,
                        None,
                        Some(reply),
                    ) {
                        Ok(frame) => self.workspace_outbox.push(frame),
                        Err(error) => return Err(error),
                    }
                }
            }
            Command::RecordsList(collection, reply) => {
                let _ = reply.send(self.records_list(&collection));
            }
            Command::RecordsReady(collection, reply) => {
                let _ = reply.send(self.store.collection(&self.root, &collection).map(|state| state.loaded));
            }
            Command::RecordsWrite(collection, writes, reply) => {
                let _ = reply.send(self.records_write(&collection, writes));
                self.publish_sync_state()?;
            }
            Command::WorkspaceOpen(workspace, reply) => {
                match self.workspaces.open(&mut self.store, &workspace) {
                    Ok(frames) => {
                        // Offline, the next connection watches it anyway.
                        if self.connected_now {
                            self.workspace_outbox.extend(frames);
                        }
                        let _ = reply.send(Ok(()));
                    }
                    Err(error) => {
                        let _ = reply.send(Err(error));
                    }
                }
                self.publish_sync_state()?;
            }
            Command::SigninStatus(workspace, reply) => {
                let _ = reply.send(self.workspaces.signin_status(
                    &self.store,
                    &self.root,
                    &workspace,
                ));
            }
            Command::SigninWrite(workspace, writes, written, reply) => {
                let _ = reply.send(self.workspaces.write_signin(
                    &mut self.store,
                    &self.root,
                    &workspace,
                    writes,
                    written,
                ));
            }
            Command::SigninRead(workspace, slot, reply) => {
                if self.connected_now {
                    if let Some(frame) = self.workspaces.read_signin(&workspace, slot, reply) {
                        self.workspace_outbox.push(frame);
                    }
                } else {
                    let _ = reply.send(Err(Error::Network));
                }
            }
            Command::ClipboardPublish(slot, ciphertext, reply) => {
                let _ = reply.send(self.clipboard.publish(slot, ciphertext));
            }
            Command::Flush(reply) => {
                if self.connected_now {
                    self.workspaces.flush();
                    self.collections.flush();
                    self.flushes.push((Instant::now() + FLUSH_DEADLINE, reply));
                } else {
                    let _ = reply.send(Err(Error::Network));
                }
            }
            Command::SigninBind(workspace, binding, reply) => {
                let _ = reply.send(
                    self.store
                        .set_device_signin(&self.root, &workspace, &binding),
                );
            }
            Command::WorkspaceSlotRead(workspace, tab, slot, reply) => {
                if self.connected_now {
                    let frame = self.workspaces.read_slot(&workspace, &tab, slot, reply);
                    self.workspace_outbox.push(frame);
                } else {
                    let _ = reply.send(Err(Error::Network));
                }
            }
            Command::Enqueue(operation_id, payload, reply) => {
                // Reject invalid edits before they acquire an irreversible device
                // counter and poison every other device's ordered replay.
                let result = (|| {
                    if self
                        .store
                        .received_intent(&self.root, &operation_id, &payload)?
                    {
                        return Ok(operation_id.clone());
                    }
                    // Imported engine changes must not become fresh local
                    // credential events, including after a crash/timeout. The
                    // durable receipt, not a renderer's in-memory flag, gates
                    // capture for this profile. Workspace edits remain allowed.
                    let decoded = serde_json::from_slice::<crate::document::Payload>(&payload).ok();
                    if let Some(decoded) = &decoded {
                        let document: crate::document::Document =
                            serde_json::from_slice(&self.store.committed_snapshot(&self.root)?)?;
                        if !document.can_publish(&self.store.grant().device_id, decoded) {
                            return Err(Error::InactiveDevice);
                        }
                    }
                    if let Some(crate::document::Payload::Credentials { batch, .. }) =
                        decoded.as_ref().map(|v| v.data())
                    {
                        if self
                            .store
                            .browser_import_journal(&self.root, &batch.profile_id)?
                            .pending
                            .is_some()
                            || self
                                .store
                                .browser_profile_binding(&self.root, &batch.profile_id)?
                                .staged
                                .is_some()
                        {
                            return Err(Error::Recovery);
                        }
                    }
                    let pending = self.store.pending_snapshot(&self.root, &mut self.reduce)?;
                    let sequence =
                        pending.committed_sequence + pending.operation_ids.len() as u64 + 1;
                    if sequence > MAX_COUNTER {
                        return Err(Error::TooLarge);
                    }
                    (self.reduce)(
                        &pending.snapshot,
                        &payload,
                        &EventContext {
                            sequence,
                            operation_id: operation_id.clone(),
                            device_id: self.store.grant().device_id.clone(),
                        },
                    )?;
                    self.store
                        .enqueue_identified(&self.root, &self.device, &operation_id, &payload)
                        .map(|_| operation_id)
                })();
                let update = self.refresh_status();
                let _ = reply.send(result);
                update?;
            }
            Command::Snapshot(reply) => {
                let _ = reply.send(self.store.committed_snapshot(&self.root));
            }
            Command::PendingSnapshot(reply) => {
                let _ = reply.send(self.store.pending_snapshot(&self.root, &mut self.reduce));
            }
            Command::ImportsApplied(sequence, reply) => {
                let result = if self.store.browser_profiles_staged(&self.root)?
                    || !self.store.browser_imports_verified(&self.root)?
                {
                    Err(Error::Recovery)
                } else if sequence <= self.store.applied_sequence()? {
                    self.imported_through = Some(self.imported_through.unwrap_or(0).max(sequence));
                    Ok(())
                } else {
                    Err(Error::Sequence)
                };
                let update = self.refresh_status();
                let _ = reply.send(result);
                update?;
            }
        }
        Ok(true)
    }

}
