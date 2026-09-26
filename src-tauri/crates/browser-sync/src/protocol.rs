use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Error, Result};

pub const MAX_COUNTER: u64 = 9_007_199_254_740_991;
pub const MAX_EVENT_BYTES: usize = 1 << 20;
pub const KDF: &str = "argon2id-m65536-t3-p1";

pub(crate) fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|u| !u.is_nil() && u.to_string() == id)
}

pub(crate) fn counter(n: u64) -> bool {
    n > 0 && n <= MAX_COUNTER
}

pub(crate) fn decode_fixed<const N: usize>(s: &str) -> Result<[u8; N]> {
    if s.len() != N.div_ceil(3) * 4 {
        return Err(Error::Invalid);
    }
    let bytes = zeroize::Zeroizing::new(STANDARD.decode(s).map_err(|_| Error::Invalid)?);
    bytes.as_slice().try_into().map_err(|_| Error::Invalid)
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub version: u8,
    pub nonce: String,
    pub ciphertext: String,
}

impl Envelope {
    pub(crate) fn decode(&self, limit: usize) -> Result<([u8; 12], Vec<u8>)> {
        if self.version != 1 || self.ciphertext.len() > limit.div_ceil(3) * 4 {
            return Err(Error::Invalid);
        }
        let nonce = decode_fixed(&self.nonce)?;
        let bytes = STANDARD
            .decode(&self.ciphertext)
            .map_err(|_| Error::Invalid)?;
        if bytes.len() < 16 || bytes.len() > limit {
            return Err(Error::Invalid);
        }
        Ok((nonce, bytes))
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KeyEnvelope {
    pub version: u8,
    pub kdf: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceGrant {
    pub workspace_id: String,
    pub device_id: String,
    pub key_epoch: u64,
    pub public_key: String,
    pub signature: String,
}

impl DeviceGrant {
    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        if !valid_id(&self.workspace_id) || !valid_id(&self.device_id) || !counter(self.key_epoch) {
            return Err(Error::Invalid);
        }
        decode_fixed::<32>(&self.public_key)?;
        Ok(serde_json::to_vec(&(
            "misty.sync.device.v1",
            &self.workspace_id,
            &self.device_id,
            self.key_epoch,
            &self.public_key,
        ))?)
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Mutation {
    pub workspace_id: String,
    pub operation_id: String,
    pub device_id: String,
    pub device_counter: u64,
    pub key_epoch: u64,
    pub envelope: Envelope,
    pub signature: String,
}

impl Mutation {
    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        if !valid_id(&self.workspace_id)
            || !valid_id(&self.operation_id)
            || !valid_id(&self.device_id)
            || !counter(self.device_counter)
            || !counter(self.key_epoch)
        {
            return Err(Error::Invalid);
        }
        self.envelope.decode(MAX_EVENT_BYTES)?;
        Ok(serde_json::to_vec(&(
            "misty.sync.mutation.v1",
            &self.workspace_id,
            &self.operation_id,
            &self.device_id,
            self.device_counter,
            self.key_epoch,
            self.envelope.version,
            &self.envelope.nonce,
            &self.envelope.ciphertext,
        ))?)
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Event {
    #[serde(flatten)]
    pub mutation: Mutation,
    pub sequence: u64,
}

pub struct EventContext {
    pub sequence: u64,
    pub operation_id: String,
    pub device_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub operation_id: String,
    pub sequence: u64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub discarded: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub workspace_id: String,
    pub key_epoch: u64,
    pub head_sequence: u64,
    pub root_public_key: String,
    pub key_envelope: KeyEnvelope,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Device {
    #[serde(flatten)]
    pub grant: DeviceGrant,
    pub last_counter: u64,
    pub revoked_at: Option<String>,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub control_version: u8,
    #[serde(default = "default_full_sync")]
    pub full_sync: bool,
    #[serde(default)]
    pub activation_request: Option<String>,
    #[serde(default)]
    pub activation_expires_at: u64,
}
fn default_full_sync() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Presence {
    pub device_id: String,
    pub online: bool,
    pub ready: bool,
    pub applied_sequence: u64,
    pub last_seen_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Replay {
    pub head_sequence: u64,
    pub events: Vec<Event>,
    pub checkpoint_required: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerFrame {
    Challenge {
        protocol_version: u8,
        challenge: String,
    },
    Welcome {
        workspace: Workspace,
        connection_id: String,
    },
    Devices {
        devices: Vec<Device>,
    },
    Presence {
        devices: Vec<Presence>,
    },
    Events {
        replay: Replay,
    },
    Ack {
        receipt: Receipt,
    },
    Error {
        code: String,
        operation_id: Option<String>,
    },
    CheckpointRequired {
        head_sequence: u64,
    },
    AccountEvent {
        event: AccountEvent,
    },
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AccountEvent {
    pub topic: String,
    pub id: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientFrame<'a> {
    Authenticate {
        after: u64,
        signature: &'a str,
    },
    Publish {
        mutation: &'a Mutation,
        #[serde(skip_serializing_if = "Option::is_none")]
        active_epoch: Option<&'a str>,
    },
    Heartbeat {
        applied_sequence: u64,
        ready: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        active_epoch: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        activation: Option<&'a Mutation>,
    },
    Resume {
        after: u64,
    },
}
