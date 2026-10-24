//! Applying one verified payload to the committed document.
use super::*;

impl Document {
    pub(super) fn apply(&mut self, payload: Payload, context: &EventContext) -> Result<()> {
        if !crate::protocol::valid_id(&context.device_id)
            || !crate::protocol::valid_id(&context.operation_id)
        {
            return Err(Error::Identity);
        }
        if self.version != 1
            || self.sequence >= MAX_COUNTER
            || context.sequence != self.sequence + 1
        {
            return Err(Error::Sequence);
        }
        payload.validate()?;
        let sequence = context.sequence;
        // Workspace mode is one-way and deterministic: every device reduces the same
        // event. Afterwards only credentials change this document; any device
        // may send them, and base-version checks resolve concurrent batches.
        if matches!(payload, Payload::WorkspaceMode { .. }) {
            self.workspace_mode = true;
            self.active_device = None;
            self.sequence = sequence;
            return Ok(());
        }
        if self.workspace_mode && !matches!(payload, Payload::Credentials { .. }) {
            self.sequence = sequence;
            return Ok(());
        }
        // Legacy events still replay before the first explicit selection. Once
        // selected, an old sender or a previous tenure cannot change the state.
        let payload = match payload {
            Payload::ActiveDevice {
                active,
                previous_epoch,
                ..
            } => {
                if active
                    || (self.active_device.as_ref().map(|v| &v.epoch) == previous_epoch.as_ref()
                        && self.is_active(&context.device_id))
                {
                    self.active_device = Some(ActiveDevice {
                        device_id: active.then(|| context.device_id.clone()),
                        epoch: context.operation_id.clone(),
                        sequence,
                    });
                }
                self.sequence = sequence;
                return Ok(());
            }
            Payload::Published {
                active_epoch,
                payload,
                ..
            } => {
                if !self.is_active(&context.device_id)
                    || self.active_device.as_ref().map(|v| &v.epoch) != Some(&active_epoch)
                {
                    self.sequence = sequence;
                    return Ok(());
                }
                *payload
            }
            other if self.active_device.is_none() || self.workspace_mode => other,
            _ => {
                self.sequence = sequence;
                return Ok(());
            }
        };
        match payload {
            Payload::ActiveDevice { .. }
            | Payload::Published { .. }
            | Payload::WorkspaceMode { .. } => return Err(Error::Invalid),
            Payload::Workspace { changes, .. } => {
                for change in changes {
                    match change {
                        Change::Create { kind, id, fields } => {
                            let key = kind.key(&id)?;
                            // Stable import IDs are idempotent; neither another
                            // create nor an offline edit can resurrect a tombstone.
                            self.records.entry(key).or_insert_with(|| Record {
                                kind,
                                id,
                                created_sequence: sequence,
                                deleted_sequence: None,
                                fields: fields
                                    .into_iter()
                                    .map(|(k, value)| (k, Field { sequence, value }))
                                    .collect(),
                            });
                        }
                        Change::Patch { kind, id, fields } => {
                            let record = self
                                .records
                                .get_mut(&kind.key(&id)?)
                                .ok_or(Error::Invalid)?;
                            if record.deleted_sequence.is_some() {
                                continue;
                            }
                            let mut values = record.values();
                            values.extend(fields.clone());
                            entities::validate(kind, &values)?;
                            record.fields.extend(
                                fields
                                    .into_iter()
                                    .map(|(k, value)| (k, Field { sequence, value })),
                            );
                        }
                        Change::Delete { kind, id } => {
                            let record =
                                self.records
                                    .entry(kind.key(&id)?)
                                    .or_insert_with(|| Record {
                                        kind,
                                        id,
                                        created_sequence: 0,
                                        deleted_sequence: None,
                                        fields: BTreeMap::new(),
                                    });
                            record.deleted_sequence.get_or_insert(sequence);
                        }
                    }
                }
            }
            Payload::Credentials { batch, .. } => {
                let mut accepted = true;
                for update in &batch.updates {
                    let key = update.area.key(&batch.profile_id)?;
                    let current = self.credentials.get(&key).map_or(0, |value| value.sequence);
                    if current != update.base_sequence {
                        accepted = false;
                    }
                }
                if accepted {
                    for update in batch.updates {
                        self.credentials.insert(
                            update.area.key(&batch.profile_id)?,
                            CredentialRecord {
                                sequence,
                                profile_id: batch.profile_id.clone(),
                                area: update.area,
                                payload: update.payload,
                            },
                        );
                    }
                } else {
                    // Advance the log without applying ANY part of a stale
                    // multi-origin batch. Only its sender needs the rejection.
                    self.rejected_credentials_by_device.insert(
                        context.device_id.clone(),
                        RejectedCredentials {
                            sequence,
                            operation_id: context.operation_id.clone(),
                            profile_id: batch.profile_id,
                            areas: batch.updates.into_iter().map(|u| u.area).collect(),
                        },
                    );
                }
            }
            Payload::Resume { resume, .. } => {
                self.resumes
                    .insert(context.device_id.clone(), ResumeRecord { sequence, resume });
            }
        }
        self.sequence = sequence;
        Ok(())
    }
}
