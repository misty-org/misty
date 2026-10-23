//! The changes a device publishes and the payloads that carry them.
use super::*;

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
    #[serde(rename = "tree_mode")]
    WorkspaceMode {
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
            Self::WorkspaceMode { version: 1 } => Ok(()),
            _ => Err(Error::Invalid),
        }
    }
}
