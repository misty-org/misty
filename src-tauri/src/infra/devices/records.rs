//! Signed device records as JSON arrays led by their domain string
//! (docs/design/devices/BRIEF.md). Records travel as their exact signed bytes;
//! nothing here re-serializes a record it verifies.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod policy;
pub use policy::{DevicePolicy, RunGrant, SharedFolder};

pub const GRANT_DOMAIN: &str = "misty.device.grant.v2";
pub const LIST_DOMAIN: &str = "misty.device.list.v1";

/// A signed device record as its exact signed bytes (base64) and signature.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedRecord {
    pub payload: String,
    pub signature: String,
}

impl SignedRecord {
    pub fn new(payload: &[u8], signature: String) -> Self {
        Self {
            payload: STANDARD.encode(payload),
            signature,
        }
    }

    pub fn bytes(&self) -> Option<Vec<u8>> {
        STANDARD
            .decode(&self.payload)
            .ok()
            .filter(|bytes| bytes.len() <= 65536)
    }

    /// The decoded fields after the domain, when the domain matches.
    fn fields(&self, domain: &str) -> Option<(Vec<u8>, Vec<Value>)> {
        let bytes = self.bytes()?;
        let mut fields: Vec<Value> = serde_json::from_slice(&bytes).ok()?;
        if fields.first()?.as_str()? != domain {
            return None;
        }
        fields.remove(0);
        Some((bytes, fields))
    }
}

pub fn valid_device_id(value: &str) -> bool {
    value.len() == 43
        && value.starts_with("device_")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn valid_public_key(value: &str) -> bool {
    STANDARD
        .decode(value)
        .is_ok_and(|raw| raw.len() == 32 && STANDARD.encode(&raw) == value)
}

#[cfg(test)]
pub fn endpoint_of(public_key: &str) -> Option<String> {
    STANDARD
        .decode(public_key)
        .ok()
        .filter(|raw| raw.len() == 32)
        .map(hex::encode)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListMember {
    pub device_id: String,
    pub public_key: String,
}

#[derive(Debug, Clone)]
pub struct DeviceList {
    pub account_id: String,
    pub vault_id: String,
    pub version: u64,
    pub admitted: Vec<ListMember>,
    pub revoked: Vec<ListMember>,
    /// The signed record the list came from, which tests tamper with.
    #[cfg(test)]
    pub record: SignedRecord,
}

impl DeviceList {
    /// Verifies a list against the vault root this device pinned.
    pub fn verify(record: &SignedRecord, root_public_key: &str) -> Option<Self> {
        let (bytes, fields) = record.fields(LIST_DOMAIN)?;
        misty_browser_sync::crypto::VaultRoot::verify_device_record(
            root_public_key,
            &bytes,
            &record.signature,
        )
        .ok()?;
        let [account, vault, version, epoch, admitted, revoked, issued]: [Value; 7] =
            fields.try_into().ok()?;
        let members = |value: &Value| -> Option<Vec<ListMember>> {
            let mut out: Vec<ListMember> = Vec::new();
            for pair in value.as_array()? {
                let pair = pair.as_array()?;
                let (id, key) = (pair.first()?.as_str()?, pair.get(1)?.as_str()?);
                if pair.len() != 2 || !valid_device_id(id) || !valid_public_key(key) {
                    return None;
                }
                if out.last().is_some_and(|last| last.device_id.as_str() >= id) {
                    return None;
                }
                out.push(ListMember {
                    device_id: id.to_owned(),
                    public_key: key.to_owned(),
                });
            }
            Some(out)
        };
        // The key epoch and issue time are checked, not kept.
        epoch.as_u64().filter(|value| *value >= 1)?;
        issued.as_i64()?;
        let list = Self {
            account_id: account.as_str()?.to_owned(),
            vault_id: vault.as_str()?.to_owned(),
            version: version.as_u64().filter(|value| *value >= 1)?,
            admitted: members(&admitted)?,
            revoked: members(&revoked)?,
            #[cfg(test)]
            record: record.clone(),
        };
        let removed: std::collections::HashSet<&str> = list
            .revoked
            .iter()
            .map(|member| member.public_key.as_str())
            .collect();
        if list
            .admitted
            .iter()
            .any(|member| removed.contains(member.public_key.as_str()))
        {
            return None;
        }
        Some(list)
    }

    pub fn admitted_key(&self, device_id: &str) -> Option<&str> {
        self.admitted
            .iter()
            .find(|member| member.device_id == device_id)
            .map(|member| member.public_key.as_str())
    }

    fn removed_keys(&self) -> std::collections::HashSet<&str> {
        self.revoked
            .iter()
            .map(|member| member.public_key.as_str())
            .collect()
    }

    /// Gossip may only carry removals: a newer list from a peer is accepted
    /// when it keeps every removal this list has and adds no device.
    pub fn is_removal_only_extension_of(&self, older: &DeviceList) -> bool {
        if self.version <= older.version
            || self.account_id != older.account_id
            || self.vault_id != older.vault_id
        {
            return false;
        }
        let removed = self.removed_keys();
        if !older.removed_keys().iter().all(|key| removed.contains(key)) {
            return false;
        }
        let known: std::collections::HashSet<&str> = older
            .admitted
            .iter()
            .map(|member| member.public_key.as_str())
            .collect();
        self.admitted
            .iter()
            .all(|member| known.contains(member.public_key.as_str()))
    }

    /// The payload for the next list: these members, one version higher.
    pub fn next_payload(
        account_id: &str,
        vault_id: &str,
        version: u64,
        key_epoch: u64,
        admitted: &[ListMember],
        revoked: &[ListMember],
        issued_at: i64,
    ) -> Result<Vec<u8>, serde_json::Error> {
        let pairs = |members: &[ListMember]| -> Vec<(String, String)> {
            let mut pairs: Vec<(String, String)> = members
                .iter()
                .map(|member| (member.device_id.clone(), member.public_key.clone()))
                .collect();
            pairs.sort();
            pairs.dedup_by(|a, b| a.0 == b.0);
            pairs
        };
        serde_json::to_vec(&(
            LIST_DOMAIN,
            account_id,
            vault_id,
            version,
            key_epoch,
            pairs(admitted),
            pairs(revoked),
            issued_at,
        ))
    }
}

pub fn grant_payload(
    account_id: &str,
    vault_id: &str,
    device_id: &str,
    key_epoch: u64,
    public_key: &str,
    sync_device_id: &str,
    issued_at: i64,
    approved_by: &str,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&(
        GRANT_DOMAIN,
        account_id,
        vault_id,
        device_id,
        key_epoch,
        public_key,
        sync_device_id,
        issued_at,
        approved_by,
    ))
}

#[cfg(test)]
mod tests;
