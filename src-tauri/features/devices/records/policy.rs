//! Signed run grants.
use serde_json::Value;

use super::{valid_device_id, SignedRecord};
use crate::devices::identity::{verify_device_signature, RUN_GRANT_DOMAIN};

#[derive(Debug, Clone)]
pub struct RunGrant {
    pub account_id: String,
    pub grant_id: String,
    pub requester_device_id: String,
    pub target_device_id: String,
    pub agent_id: String,
    /// The chat or scheduled run this grant is for. A command's workspace and its write access to a
    /// shared folder come from this, never from the job, so a job can't reach another chat's.
    pub chat_key: String,
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
            &self.chat_key,
            &self.capabilities,
            &self.scopes,
            self.issued_at,
            self.expires_at,
        ))
    }

    pub fn verify(record: &SignedRecord, requester_public_key: &str, now: i64) -> Option<Self> {
        let (bytes, fields) = record.fields(RUN_GRANT_DOMAIN)?;
        if !verify_device_signature(requester_public_key, &bytes, &record.signature) {
            return None;
        }
        let [account, grant, requester, target, agent, chat_key, capabilities, scopes, issued, expires]: [Value; 10] =
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
            chat_key: chat_key.as_str()?.to_owned(),
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
