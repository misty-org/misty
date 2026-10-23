//! Signed device policies (shared folders per device) and run grants.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{valid_device_id, SignedRecord};
use crate::infra::devices::identity::{verify_device_signature, POLICY_DOMAIN, RUN_GRANT_DOMAIN};

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
