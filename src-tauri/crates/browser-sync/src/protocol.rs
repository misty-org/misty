use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{Error, Result};

mod frames;
pub use frames::{AccountEvent, ClientFrame, ServerFrame};

pub const MAX_COUNTER: u64 = 9_007_199_254_740_991;
pub const MAX_EVENT_BYTES: usize = 1 << 20;
/// The legacy wrapper: the root sealed under a sync password plus a separate
/// 256-bit sync secret. New vaults never use it; existing ones are upgraded.
pub const KDF: &str = "argon2id-m65536-t3-p1";
/// The account wrapper: the root sealed under a key derived on the device from
/// the person's Misty password alone (`crypto::AccountKeys`). The server only
/// ever sees a different value derived from the same password.
pub const KDF_ACCOUNT: &str = "argon2id-m65536-t3-p1+hkdf-sha256.account-v2";

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

impl KeyEnvelope {
    pub fn is_account(&self) -> bool {
        self.kdf == KDF_ACCOUNT
    }

    /// What a key transition signs: a digest of every wrapper field, so a
    /// transition covers exactly one wrapper and cannot be moved to another.
    pub fn digest(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(b"misty.sync.key-envelope.v1");
        for part in [
            self.version.to_string().as_str(),
            &self.kdf,
            &self.salt,
            &self.nonce,
            &self.ciphertext,
        ] {
            hash.update(b"\n");
            hash.update(part.as_bytes());
        }
        hash.finalize().into()
    }
}

/// Authorizes replacing a vault's password wrapper (a password change, or the
/// one-time upgrade from the sync secret). It is signed by the vault root, so
/// only a device that holds the unlocked root can make one, and every other
/// device checks it against the root public key it pinned when it enrolled. The
/// server can store and serve it but cannot forge or substitute a wrapper.
/// `generation` only rises, which rejects a server replaying an older wrapper.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KeyTransition {
    pub generation: u64,
    pub signature: String,
}

impl KeyTransition {
    pub fn signing_bytes(vault_id: &str, generation: u64, envelope: &KeyEnvelope) -> Result<Vec<u8>> {
        if !valid_id(vault_id) || !counter(generation) {
            return Err(Error::Invalid);
        }
        Ok(serde_json::to_vec(&(
            "misty.sync.key-transition.v1",
            vault_id,
            generation,
            STANDARD.encode(envelope.digest()),
        ))?)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceGrant {
    #[serde(alias = "workspace_id")]
    pub vault_id: String,
    pub device_id: String,
    pub key_epoch: u64,
    pub public_key: String,
    pub signature: String,
}

impl DeviceGrant {
    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        if !valid_id(&self.vault_id) || !valid_id(&self.device_id) || !counter(self.key_epoch) {
            return Err(Error::Invalid);
        }
        decode_fixed::<32>(&self.public_key)?;
        Ok(serde_json::to_vec(&(
            "misty.sync.device.v1",
            &self.vault_id,
            &self.device_id,
            self.key_epoch,
            &self.public_key,
        ))?)
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Mutation {
    #[serde(alias = "workspace_id")]
    pub vault_id: String,
    pub operation_id: String,
    pub device_id: String,
    pub device_counter: u64,
    pub key_epoch: u64,
    pub envelope: Envelope,
    pub signature: String,
}

impl Mutation {
    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        if !valid_id(&self.vault_id)
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
            &self.vault_id,
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
pub struct Vault {
    #[serde(alias = "workspace_id")]
    pub vault_id: String,
    pub key_epoch: u64,
    pub head_sequence: u64,
    pub root_public_key: String,
    /// The personal vault's root, wrapped by the sync password and secret.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_envelope: Option<KeyEnvelope>,
    /// Any other Space vault's root, sealed to the personal root
    /// (`VaultRoot::open_space_root`). Exactly one of the two is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_key_envelope: Option<Envelope>,
    /// Present once the wrapper has been replaced after creation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_transition: Option<KeyTransition>,
}

impl Vault {
    pub fn is_space(&self) -> bool {
        self.space_key_envelope.is_some()
    }

    /// How many times the wrapper has been replaced; 0 for the original.
    pub fn key_generation(&self) -> u64 {
        self.key_transition.as_ref().map_or(0, |t| t.generation)
    }
}

impl From<SpaceVault> for Vault {
    fn from(vault: SpaceVault) -> Self {
        Self {
            vault_id: vault.vault_id,
            key_epoch: vault.key_epoch,
            head_sequence: vault.head_sequence,
            root_public_key: vault.root_public_key,
            key_envelope: vault.key_envelope,
            space_key_envelope: vault.space_key_envelope,
            key_transition: vault.key_transition,
        }
    }
}

/// One of the account's vaults, one per Space. The personal vault carries the
/// password-wrapped `key_envelope`; every other vault a `space_key_envelope`
/// sealed to the personal root.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpaceVault {
    pub space_id: String,
    pub vault_id: String,
    pub key_epoch: u64,
    pub head_sequence: u64,
    pub root_public_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_envelope: Option<KeyEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_key_envelope: Option<Envelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_transition: Option<KeyTransition>,
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
    /// The device keeps bookmarks in collections.
    #[serde(default)]
    #[serde(alias = "cold_records")]
    pub uses_collections: bool,
    #[serde(default)]
    pub activation_request: Option<String>,
    #[serde(default)]
    pub activation_expires_at: u64,
    #[serde(default)]
    pub os_version: String,
    #[serde(default)]
    #[serde(alias = "activation_tree_id")]
    pub activation_workspace_id: Option<String>,
    #[serde(default)]
    #[serde(alias = "tree_last_counter")]
    pub workspace_last_counter: u64,
    #[serde(default)]
    pub created_at: Option<String>,
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

/// Connection parameter telling the server this client batches its changes:
/// it may send `batch_policy` frames and answer over-rate ops with
/// `sync_rate_limited` (which older clients would treat as a rejected edit).
pub const BATCHING: &str = "1";

/// Wire protocol spoken by this client: workspaces and collections plus the
/// vault-wide credential log on the same socket. Version 3 renamed trees to
/// workspaces and the sync workspace to the vault on the wire.
pub const PROTOCOL_VERSION: u8 = 3;
