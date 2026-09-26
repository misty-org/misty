//! Deterministic committed-state reducer. Device focus stays outside this model;
//! resume records are read only when the user explicitly chooses Continue here.
pub mod credentials;
pub mod entities;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::{
    protocol::{EventContext, MAX_COUNTER, MAX_EVENT_BYTES},
    Error, Result,
};
use entities::{Fields, Kind};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub sequence: u64,
    pub value: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub kind: Kind,
    pub id: String,
    pub created_sequence: u64,
    pub deleted_sequence: Option<u64>,
    pub fields: BTreeMap<String, Field>,
}

impl Record {
    pub fn values(&self) -> Fields {
        self.fields
            .iter()
            .map(|(k, v)| (k.clone(), v.value.clone()))
            .collect()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CredentialRecord {
    pub sequence: u64,
    pub profile_id: String,
    pub area: credentials::Area,
    pub payload: Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RejectedCredentials {
    pub sequence: u64,
    pub operation_id: String,
    pub profile_id: String,
    pub areas: Vec<credentials::Area>,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resume {
    pub active_window_id: String,
    pub active_layout_id: String,
    pub focused_pane_id: String,
    pub active_tab_by_pane: BTreeMap<String, String>,
}

impl Resume {
    fn validate(&self) -> Result<()> {
        if !entities::valid_id(&self.active_window_id)
            || !entities::valid_id(&self.active_layout_id)
            || !entities::valid_id(&self.focused_pane_id)
            || self.active_tab_by_pane.len() > 4096
            || self
                .active_tab_by_pane
                .iter()
                .any(|(k, v)| !entities::valid_id(k) || !entities::valid_id(v))
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResumeRecord {
    pub sequence: u64,
    pub resume: Resume,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveDevice {
    pub device_id: Option<String>,
    pub epoch: String,
    pub sequence: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub version: u8,
    pub sequence: u64,
    pub records: BTreeMap<String, Record>,
    pub credentials: BTreeMap<String, CredentialRecord>,
    pub rejected_credentials_by_device: BTreeMap<String, RejectedCredentials>,
    pub resumes: BTreeMap<String, ResumeRecord>,
    #[serde(default)]
    pub active_device: Option<ActiveDevice>,
    /// Set by the first `TreeMode` event. Workspaces then live in per-device
    /// trees; this log carries only account-wide credentials, from any device.
    #[serde(default)]
    pub tree_mode: bool,
}

/// This is the renderer boundary. Credential payloads and encryption/signing
/// material have no fields in this type and cannot be accidentally serialized.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceView {
    pub version: u8,
    pub sequence: u64,
    pub records: Vec<ViewRecord>,
    pub orphaned_tab_ids: Vec<String>,
    pub orphaned_website_ids: Vec<String>,
    pub resumes: BTreeMap<String, ResumeRecord>,
    pub active_device: Option<ActiveDevice>,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewRecord {
    pub kind: Kind,
    pub id: String,
    pub fields: Fields,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            sequence: 0,
            records: BTreeMap::new(),
            credentials: BTreeMap::new(),
            rejected_credentials_by_device: BTreeMap::new(),
            resumes: BTreeMap::new(),
            active_device: None,
            tree_mode: false,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Change {
    Create {
        kind: Kind,
        id: String,
        fields: Fields,
    },
    Patch {
        kind: Kind,
        id: String,
        fields: Fields,
    },
    Delete {
        kind: Kind,
        id: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Payload {
    ActiveDevice {
        version: u8,
        active: bool,
        previous_epoch: Option<String>,
    },
    Published {
        version: u8,
        active_epoch: String,
        payload: Box<Payload>,
    },
    Workspace {
        version: u8,
        changes: Vec<Change>,
    },
    Credentials {
        version: u8,
        batch: credentials::Batch,
    },
    Resume {
        version: u8,
        resume: Resume,
    },
    TreeMode {
        version: u8,
    },
}

impl Payload {
    pub fn published(self, active_epoch: String) -> Self {
        Self::Published {
            version: 1,
            active_epoch,
            payload: Box::new(self),
        }
    }

    pub fn data(&self) -> &Self {
        match self {
            Self::Published { payload, .. } => payload,
            _ => self,
        }
    }

    pub fn validate(&self) -> Result<()> {
        match self {
            Self::ActiveDevice {
                version: 1,
                previous_epoch,
                ..
            } if previous_epoch
                .as_deref()
                .is_none_or(crate::protocol::valid_id) =>
            {
                Ok(())
            }
            Self::Published {
                version: 1,
                active_epoch,
                payload,
            } if crate::protocol::valid_id(active_epoch)
                && matches!(
                    payload.as_ref(),
                    Self::Workspace { .. } | Self::Credentials { .. } | Self::Resume { .. }
                ) =>
            {
                payload.validate()
            }
            Self::Workspace {
                version: 1,
                changes,
            } if !changes.is_empty() && changes.len() <= 256 => {
                for change in changes {
                    match change {
                        Change::Create { kind, id, fields } => {
                            kind.key(id)?;
                            entities::validate(*kind, fields)?;
                        }
                        Change::Patch { kind, id, fields } => {
                            kind.key(id)?;
                            if fields.is_empty() || fields.len() > 16 {
                                return Err(Error::Invalid);
                            }
                        }
                        Change::Delete { kind, id } => {
                            kind.key(id)?;
                        }
                    }
                }
                Ok(())
            }
            Self::Credentials { version: 1, batch } => batch.validate(),
            Self::Resume { version: 1, resume } => resume.validate(),
            Self::TreeMode { version: 1 } => Ok(()),
            _ => Err(Error::Invalid),
        }
    }
}

impl Document {
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>> {
        Ok(Zeroizing::new(serde_json::to_vec(self)?))
    }

    pub fn workspace_view(&self) -> Result<WorkspaceView> {
        self.validate()?;
        let records: Vec<_> = self
            .records
            .values()
            .filter(|r| r.deleted_sequence.is_none())
            .map(|r| ViewRecord {
                kind: r.kind,
                id: r.id.clone(),
                fields: r.values(),
            })
            .collect();
        let mut orphaned_website_ids = Vec::new();
        for record in records.iter().filter(|r| r.kind == Kind::Website) {
            let website: entities::Website =
                serde_json::from_value(serde_json::to_value(&record.fields)?)?;
            if self.live(Kind::Group, &website.group_id).is_none() {
                orphaned_website_ids.push(record.id.clone());
            }
        }
        Ok(WorkspaceView {
            version: 1,
            sequence: self.sequence,
            records,
            orphaned_tab_ids: self.orphaned_tabs()?,
            orphaned_website_ids,
            resumes: self.resumes.clone(),
            active_device: self.active_device.clone(),
        })
    }

    fn apply(&mut self, payload: Payload, context: &EventContext) -> Result<()> {
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
        // Tree mode is one-way and deterministic: every device reduces the same
        // event. Afterwards only credentials change this document; any device
        // may send them, and base-version checks resolve concurrent batches.
        if matches!(payload, Payload::TreeMode { .. }) {
            self.tree_mode = true;
            self.active_device = None;
            self.sequence = sequence;
            return Ok(());
        }
        if self.tree_mode && !matches!(payload, Payload::Credentials { .. }) {
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
            other if self.active_device.is_none() || self.tree_mode => other,
            _ => {
                self.sequence = sequence;
                return Ok(());
            }
        };
        match payload {
            Payload::ActiveDevice { .. } | Payload::Published { .. } | Payload::TreeMode { .. } => {
                return Err(Error::Invalid)
            }
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

    pub fn live(&self, kind: Kind, id: &str) -> Option<&Record> {
        self.records
            .get(&kind.key(id).ok()?)
            .filter(|r| r.deleted_sequence.is_none())
    }

    pub fn is_active(&self, device_id: &str) -> bool {
        self.active_device
            .as_ref()
            .and_then(|v| v.device_id.as_deref())
            == Some(device_id)
    }

    pub fn can_publish(&self, device_id: &str, payload: &Payload) -> bool {
        if self.tree_mode {
            return matches!(payload, Payload::Credentials { .. } | Payload::TreeMode { .. });
        }
        match payload {
            Payload::TreeMode { .. } => true,
            Payload::ActiveDevice { .. } => true,
            Payload::Published { active_epoch, .. } => {
                self.is_active(device_id)
                    && self.active_device.as_ref().map(|v| &v.epoch) == Some(active_epoch)
            }
            _ => self.active_device.is_none(), // historical clients before selection
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.active_device.as_ref().is_some_and(|v| {
            !crate::protocol::valid_id(&v.epoch)
                || v.sequence == 0
                || v.sequence > self.sequence
                || v.device_id
                    .as_deref()
                    .is_some_and(|id| !crate::protocol::valid_id(id))
        }) {
            return Err(Error::Invalid);
        }
        if self.version != 1
            || self.sequence > MAX_COUNTER
            || self.records.len() > 50_000
            || self.credentials.len() > 10_000
            || self.resumes.len() > 1024
            || self.rejected_credentials_by_device.len() > 1024
        {
            return Err(Error::Invalid);
        }
        for (key, record) in &self.records {
            if *key != record.kind.key(&record.id)?
                || record.created_sequence > self.sequence
                || record
                    .deleted_sequence
                    .is_some_and(|s| s == 0 || s > self.sequence)
                || record
                    .fields
                    .values()
                    .any(|f| f.sequence == 0 || f.sequence > self.sequence)
            {
                return Err(Error::Invalid);
            }
            if record.deleted_sequence.is_none() {
                if record.created_sequence == 0 {
                    return Err(Error::Invalid);
                }
                entities::validate(record.kind, &record.values())?;
            }
        }
        for (key, record) in &self.credentials {
            if record.sequence == 0
                || record.sequence > self.sequence
                || *key != record.area.key(&record.profile_id)?
            {
                return Err(Error::Invalid);
            }
            record.area.validate_payload(&record.payload)?;
        }
        for (device, record) in &self.resumes {
            if !crate::protocol::valid_id(device)
                || record.sequence == 0
                || record.sequence > self.sequence
            {
                return Err(Error::Invalid);
            }
            record.resume.validate()?;
        }
        for (device, rejected) in &self.rejected_credentials_by_device {
            if !crate::protocol::valid_id(device)
                || !crate::protocol::valid_id(&rejected.operation_id)
                || rejected.sequence == 0
                || rejected.sequence > self.sequence
                || rejected.areas.is_empty()
                || rejected.areas.len() > 128
            {
                return Err(Error::Invalid);
            }
            for area in &rejected.areas {
                area.key(&rejected.profile_id)?;
            }
        }
        Ok(())
    }

    /// Projection must expose these views in deterministic recovery layouts.
    /// Concurrent tree/container changes never implicitly delete a tab record.
    pub fn orphaned_tabs(&self) -> Result<Vec<String>> {
        let mut orphaned = Vec::new();
        for record in self
            .records
            .values()
            .filter(|r| r.kind == Kind::Tab && r.deleted_sequence.is_none())
        {
            let tab: entities::Tab =
                serde_json::from_value(serde_json::to_value(record.values())?)?;
            let valid = if let Some(layout) = self.live(Kind::Layout, &tab.placement.layout_id) {
                let layout: entities::Layout =
                    serde_json::from_value(serde_json::to_value(layout.values())?)?;
                self.live(Kind::Window, &layout.window_id).is_some()
                    && layout.tree.panes()?.contains(&tab.placement.pane_id)
            } else {
                false
            };
            if !valid {
                orphaned.push(record.id.clone());
            }
        }
        Ok(orphaned)
    }
}

pub fn reduce(state: &[u8], payload: &[u8], context: &EventContext) -> Result<Zeroizing<Vec<u8>>> {
    if payload.len() > MAX_EVENT_BYTES - 16 || state.len() > (32 << 20) - 16 {
        return Err(Error::TooLarge);
    }
    let mut document: Document = serde_json::from_slice(state)?;
    document.validate()?;
    let payload: Payload = serde_json::from_slice(payload)?;
    document.apply(payload, context)?;
    document.validate()?;
    document.encode()
}
