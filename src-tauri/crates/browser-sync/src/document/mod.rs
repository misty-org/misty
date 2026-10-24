//! Deterministic committed-state reducer. Device focus stays outside this model;
//! resume records are read only when the user explicitly chooses Continue here.
pub mod credentials;
pub mod entities;
pub mod renderer;

mod apply;
mod integrity;
mod payload;
pub use payload::{Change, Payload};

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
    #[serde(rename = "active_layout_id")]
    pub active_tab_id: String,
    pub focused_pane_id: String,
    #[serde(rename = "active_tab_by_pane")]
    pub active_view_by_pane: BTreeMap<String, String>,
}

impl Resume {
    fn validate(&self) -> Result<()> {
        if !entities::valid_id(&self.active_window_id)
            || !entities::valid_id(&self.active_tab_id)
            || !entities::valid_id(&self.focused_pane_id)
            || self.active_view_by_pane.len() > 4096
            || self
                .active_view_by_pane
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
    /// Set by the first `WorkspaceMode` event. Workspaces then live in per-device
    /// workspaces; this log carries only account-wide credentials, from any device.
    #[serde(default)]
    #[serde(rename = "tree_mode")]
    pub workspace_mode: bool,
}

/// This is the renderer boundary. Credential payloads and encryption/signing
/// material have no fields in this type and cannot be accidentally serialized.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceView {
    pub version: u8,
    pub sequence: u64,
    pub records: Vec<ViewRecord>,
    pub orphaned_view_ids: Vec<String>,
    pub orphaned_bookmark_ids: Vec<String>,
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
            workspace_mode: false,
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
        let mut orphaned_bookmark_ids = Vec::new();
        for record in records.iter().filter(|r| r.kind == Kind::Bookmark) {
            let bookmark: entities::Bookmark =
                serde_json::from_value(serde_json::to_value(&record.fields)?)?;
            if self.live(Kind::Folder, &bookmark.folder_id).is_none() {
                orphaned_bookmark_ids.push(record.id.clone());
            }
        }
        Ok(WorkspaceView {
            version: 1,
            sequence: self.sequence,
            records,
            orphaned_view_ids: self.orphaned_views()?,
            orphaned_bookmark_ids,
            resumes: self.resumes.clone(),
            active_device: self.active_device.clone(),
        })
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
        if self.workspace_mode {
            return matches!(
                payload,
                Payload::Credentials { .. } | Payload::WorkspaceMode { .. }
            );
        }
        match payload {
            Payload::WorkspaceMode { .. } => true,
            Payload::ActiveDevice { .. } => true,
            Payload::Published { active_epoch, .. } => {
                self.is_active(device_id)
                    && self.active_device.as_ref().map(|v| &v.epoch) == Some(active_epoch)
            }
            _ => self.active_device.is_none(), // historical clients before selection
        }
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
