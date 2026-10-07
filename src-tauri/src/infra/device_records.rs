//! Signed device records as JSON arrays led by their domain string
//! (docs/design/devices/BRIEF.md). Records travel as their exact signed bytes;
//! nothing here re-serializes a record it verifies.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infra::device_identity::{verify_device_signature, POLICY_DOMAIN, RUN_GRANT_DOMAIN};

pub const GRANT_DOMAIN: &str = "misty.device.grant.v2";
pub const LIST_DOMAIN: &str = "misty.device.list.v1";

pub use crate::domain::connected_devices::SignedRecord;

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
    pub key_epoch: u64,
    pub admitted: Vec<ListMember>,
    pub revoked: Vec<ListMember>,
    pub issued_at: i64,
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
        let list = Self {
            account_id: account.as_str()?.to_owned(),
            vault_id: vault.as_str()?.to_owned(),
            version: version.as_u64().filter(|value| *value >= 1)?,
            key_epoch: epoch.as_u64().filter(|value| *value >= 1)?,
            admitted: members(&admitted)?,
            revoked: members(&revoked)?,
            issued_at: issued.as_i64()?,
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

    /// The admitted device whose iroh endpoint is this hex key.
    pub fn device_for_endpoint(&self, endpoint: &str) -> Option<&str> {
        self.admitted
            .iter()
            .find(|member| endpoint_of(&member.public_key).as_deref() == Some(endpoint))
            .map(|member| member.device_id.as_str())
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolder {
    pub scope_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevicePolicy {
    pub version: u64,
    /// "off", "view" or "edit".
    pub files: String,
    pub clipboard: bool,
    pub agent_surfaces: Vec<String>,
    pub shared_folders: Vec<SharedFolder>,
}

impl DevicePolicy {
    pub fn first(shared_folders: Vec<SharedFolder>) -> Self {
        Self {
            version: 0,
            files: "view".to_owned(),
            clipboard: false,
            agent_surfaces: vec!["browser".to_owned(), "folders".to_owned()],
            shared_folders,
        }
    }

    pub fn allows_surface(&self, surface: &str) -> bool {
        self.agent_surfaces.iter().any(|value| value == surface)
    }

    pub fn shares_folder(&self, scope_id: &str) -> bool {
        self.shared_folders
            .iter()
            .any(|folder| folder.scope_id == scope_id)
    }

    pub fn payload(
        &self,
        account_id: &str,
        device_id: &str,
        issued_at: i64,
    ) -> Result<Vec<u8>, serde_json::Error> {
        let mut surfaces = self.agent_surfaces.clone();
        surfaces.sort();
        surfaces.dedup();
        let folders: Vec<(String, String)> = self
            .shared_folders
            .iter()
            .map(|folder| (folder.scope_id.clone(), folder.name.clone()))
            .collect();
        serde_json::to_vec(&(
            POLICY_DOMAIN,
            account_id,
            device_id,
            self.version,
            &self.files,
            self.clipboard,
            surfaces,
            folders,
            issued_at,
        ))
    }
}

#[derive(Debug, Clone)]
pub struct RunGrant {
    pub account_id: String,
    pub grant_id: String,
    pub requester_device_id: String,
    pub target_device_id: String,
    pub agent_id: String,
    pub capabilities: Vec<String>,
    pub scopes: Vec<String>,
    pub issued_at: i64,
    pub expires_at: i64,
}

impl RunGrant {
    pub fn payload(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&(
            RUN_GRANT_DOMAIN,
            &self.account_id,
            &self.grant_id,
            &self.requester_device_id,
            &self.target_device_id,
            &self.agent_id,
            &self.capabilities,
            &self.scopes,
            self.issued_at,
            self.expires_at,
        ))
    }

    /// Reads who claims to have signed it, so their key can be looked up.
    pub fn claimed_requester(record: &SignedRecord) -> Option<String> {
        let (_, fields) = record.fields(RUN_GRANT_DOMAIN)?;
        fields.get(2)?.as_str().map(str::to_owned)
    }

    pub fn verify(record: &SignedRecord, requester_public_key: &str, now: i64) -> Option<Self> {
        let (bytes, fields) = record.fields(RUN_GRANT_DOMAIN)?;
        if !verify_device_signature(requester_public_key, &bytes, &record.signature) {
            return None;
        }
        let [account, grant, requester, target, agent, capabilities, scopes, issued, expires]: [Value; 9] =
            fields.try_into().ok()?;
        let strings = |value: &Value| -> Option<Vec<String>> {
            value
                .as_array()?
                .iter()
                .map(|item| item.as_str().map(str::to_owned))
                .collect()
        };
        let grant = Self {
            account_id: account.as_str()?.to_owned(),
            grant_id: grant.as_str()?.to_owned(),
            requester_device_id: requester.as_str()?.to_owned(),
            target_device_id: target.as_str()?.to_owned(),
            agent_id: agent.as_str()?.to_owned(),
            capabilities: strings(&capabilities)?,
            scopes: strings(&scopes)?,
            issued_at: issued.as_i64()?,
            expires_at: expires.as_i64()?,
        };
        let fresh = grant.expires_at > now
            && grant.issued_at <= now + 600
            && grant.expires_at - grant.issued_at <= 24 * 3600;
        (fresh
            && valid_device_id(&grant.requester_device_id)
            && valid_device_id(&grant.target_device_id))
        .then_some(grant)
    }

    pub fn allows(&self, scope: &str, capability: &str) -> bool {
        self.scopes.iter().any(|value| value == scope)
            && self.capabilities.iter().any(|value| value == capability)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::device_identity::DeviceIdentity;
    use misty_browser_sync::crypto::VaultRoot;

    fn member(id: char, key: u8) -> ListMember {
        ListMember {
            device_id: format!("device_00000000-0000-0000-0000-00000000000{id}"),
            public_key: STANDARD.encode([key; 32]),
        }
    }

    fn list(
        root: &VaultRoot,
        version: u64,
        admitted: &[ListMember],
        revoked: &[ListMember],
    ) -> DeviceList {
        let payload =
            DeviceList::next_payload("acct", "vault", version, 1, admitted, revoked, 1).unwrap();
        let record = SignedRecord::new(&payload, root.sign_device_record(&payload).unwrap());
        DeviceList::verify(&record, &root.public_key().unwrap()).unwrap()
    }

    #[test]
    fn lists_verify_only_against_their_root_and_gossip_only_removes() {
        let root = VaultRoot::generate();
        let (a, b, c) = (member('a', 1), member('b', 2), member('c', 3));
        let first = list(&root, 1, &[a.clone(), b.clone()], &[]);
        assert_eq!(
            first.device_for_endpoint(&hex::encode([2u8; 32])),
            Some(b.device_id.as_str())
        );
        let other = VaultRoot::generate();
        assert!(DeviceList::verify(&first.record, &other.public_key().unwrap()).is_none());
        let mut tampered = first.record.clone();
        tampered.payload = STANDARD.encode(
            DeviceList::next_payload(
                "acct",
                "vault",
                1,
                1,
                &[a.clone(), b.clone(), c.clone()],
                &[],
                1,
            )
            .unwrap(),
        );
        assert!(DeviceList::verify(&tampered, &root.public_key().unwrap()).is_none());
        // Removing B is a removal-only extension; adding C is not; forgetting a
        // removal is not.
        let removal = list(&root, 2, &[a.clone()], &[b.clone()]);
        assert!(removal.is_removal_only_extension_of(&first));
        assert!(!list(&root, 2, &[a.clone(), b.clone(), c.clone()], &[])
            .is_removal_only_extension_of(&first));
        assert!(!list(&root, 3, &[a.clone()], &[]).is_removal_only_extension_of(&removal));
        assert!(!removal.is_removal_only_extension_of(&removal));
        // A key can't be both admitted and removed.
        let payload =
            DeviceList::next_payload("acct", "vault", 4, 1, &[a.clone()], &[a.clone()], 1).unwrap();
        let record = SignedRecord::new(&payload, root.sign_device_record(&payload).unwrap());
        assert!(DeviceList::verify(&record, &root.public_key().unwrap()).is_none());
    }

    #[test]
    fn run_grants_verify_their_signer_and_expire() {
        let credentials = tempfile::tempdir().unwrap();
        let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
        let identity = DeviceIdentity::load("acct-grant", "device_aaaaaaaaaaaa").unwrap();
        let grant = RunGrant {
            account_id: "acct-grant".into(),
            grant_id: "rungrant_1".into(),
            requester_device_id: member('a', 1).device_id,
            target_device_id: member('b', 2).device_id,
            agent_id: String::new(),
            capabilities: vec!["files.read".into()],
            scopes: vec!["scope-1".into()],
            issued_at: 1_000,
            expires_at: 2_000,
        };
        let payload = grant.payload().unwrap();
        let record = SignedRecord::new(&payload, identity.sign_record(&payload).unwrap());
        let verified = RunGrant::verify(&record, &identity.public_key(), 1_500).unwrap();
        assert!(verified.allows("scope-1", "files.read"));
        assert!(!verified.allows("scope-1", "files.send"));
        assert!(!verified.allows("scope-2", "files.read"));
        assert!(RunGrant::verify(&record, &identity.public_key(), 2_000).is_none());
        assert!(RunGrant::verify(&record, &STANDARD.encode([9u8; 32]), 1_500).is_none());
        assert_eq!(
            RunGrant::claimed_requester(&record),
            Some(member('a', 1).device_id)
        );
    }
}
