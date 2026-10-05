//! Local sessions between paired devices.
//!
//! An explicit connect is authorized once by Misty's server. In that handshake
//! each device gives the other a random token for its direction of the pair.
//! Until the session expires, reconnects present that token and are checked
//! here, on the device, without the server. Each device also keeps its own
//! consent to file changes and clipboard sharing, so both keep working while
//! the server is unreachable. Everything lives in the OS credential store and
//! never leaves the device.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

const SESSION_SERVICE: &str = "com.misty.connected-devices.sessions";
pub const DEFAULT_SESSION_DAYS: u32 = 30;
pub const MAX_SESSION_DAYS: u32 = 365;
const DAY_SECONDS: i64 = 24 * 60 * 60;

/// What this device lets one paired device do.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConsent {
    /// The peer may create, change and delete files on this device.
    pub accepts_writes: bool,
    /// This device sends its clipboard to the peer and accepts the peer's.
    pub shares_clipboard: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSession {
    peer_endpoint_id: String,
    /// The token this device presents to the peer.
    #[serde(default)]
    outgoing_token: Option<String>,
    #[serde(default)]
    outgoing_expires_at: i64,
    /// SHA-256 of the token the peer presents to this device.
    #[serde(default)]
    incoming_token_hash: Option<String>,
    #[serde(default)]
    incoming_expires_at: i64,
    /// Where the peer was last reached, for reconnecting without the server.
    #[serde(default)]
    address: Option<serde_json::Value>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSessions {
    #[serde(default)]
    sessions: HashMap<String, DeviceSession>,
    #[serde(default)]
    consent: HashMap<String, PeerConsent>,
    #[serde(default)]
    session_days: Option<u32>,
}

/// A session this device can resume by dialing the peer.
pub struct ResumableSession {
    pub device_id: String,
    pub endpoint_id: String,
    pub token: String,
    pub expires_at: i64,
    pub address: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub device_id: String,
    /// When this device's access to the peer ends.
    pub outgoing_expires_at: i64,
    /// When the peer's access to this device ends.
    pub incoming_expires_at: i64,
}

#[derive(Clone, Default)]
pub struct DeviceSessionStore {
    scope: Arc<Mutex<String>>,
    inner: Arc<Mutex<StoredSessions>>,
}

impl DeviceSessionStore {
    /// Switches to one account's device. Sessions never carry across accounts.
    pub fn open(&self, account_id: &str, device_id: &str) -> ApiResult<()> {
        let scope = format!("{account_id}:{device_id}");
        let stored = match credential_store::load(SESSION_SERVICE, &scope) {
            Ok(Some(encoded)) => serde_json::from_str(&encoded).unwrap_or_default(),
            Ok(None) => StoredSessions::default(),
            Err(error) => {
                return Err(ApiError::Message(format!(
                    "Could not read device sessions: {error}"
                )))
            }
        };
        *self.scope.lock().map_err(lock_error)? = scope;
        *self.inner.lock().map_err(lock_error)? = stored;
        Ok(())
    }

    pub fn session_days(&self) -> u32 {
        self.inner
            .lock()
            .ok()
            .and_then(|stored| stored.session_days)
            .unwrap_or(DEFAULT_SESSION_DAYS)
    }

    pub fn set_session_days(&self, days: u32) -> ApiResult<()> {
        let days = days.clamp(1, MAX_SESSION_DAYS);
        self.update(|stored| stored.session_days = Some(days))
    }

    /// How long a session started now lasts, as an expiry in Unix seconds.
    pub fn expiry_from(&self, now: i64) -> i64 {
        now + i64::from(self.session_days()) * DAY_SECONDS
    }

    pub fn consent(&self, device_id: &str) -> PeerConsent {
        self.inner
            .lock()
            .ok()
            .and_then(|stored| stored.consent.get(device_id).copied())
            .unwrap_or_default()
    }

    /// Replaces the consent for every paired device. Unlisted devices get none.
    pub fn set_consent(&self, consent: HashMap<String, PeerConsent>) -> ApiResult<()> {
        self.update(|stored| stored.consent = consent)
    }

    /// Mints the token the peer will present here, and returns it to hand over.
    pub fn issue_incoming(
        &self,
        device_id: &str,
        endpoint_id: &str,
        expires_at: i64,
    ) -> ApiResult<String> {
        let token = new_token();
        let hash = token_hash(&token);
        self.update(|stored| {
            let session = session_for(stored, device_id, endpoint_id);
            session.incoming_token_hash = Some(hash);
            session.incoming_expires_at = expires_at;
        })?;
        Ok(token)
    }

    pub fn store_outgoing(
        &self,
        device_id: &str,
        endpoint_id: &str,
        token: String,
        expires_at: i64,
        address: Option<serde_json::Value>,
    ) -> ApiResult<()> {
        self.update(|stored| {
            let session = session_for(stored, device_id, endpoint_id);
            session.outgoing_token = Some(token);
            session.outgoing_expires_at = expires_at;
            if address.is_some() {
                session.address = address;
            }
        })
    }

    /// The incoming session's expiry when `token` is valid for this peer.
    pub fn verify_incoming(
        &self,
        device_id: &str,
        endpoint_id: &str,
        token: &str,
        now: i64,
    ) -> Option<i64> {
        let stored = self.inner.lock().ok()?;
        let session = stored.sessions.get(device_id)?;
        let expected = session.incoming_token_hash.as_deref()?;
        (session.peer_endpoint_id == endpoint_id
            && session.incoming_expires_at > now
            && constant_time_eq(expected.as_bytes(), token_hash(token).as_bytes()))
        .then_some(session.incoming_expires_at)
    }

    /// Whether the peer's session with this device is still in force.
    pub fn incoming_active(&self, device_id: &str, now: i64) -> bool {
        self.inner.lock().is_ok_and(|stored| {
            stored.sessions.get(device_id).is_some_and(|session| {
                session.incoming_token_hash.is_some() && session.incoming_expires_at > now
            })
        })
    }

    /// Where the peer can be reached, as it reported when it connected.
    pub fn remember_address(&self, device_id: &str, address: serde_json::Value) -> ApiResult<()> {
        self.update(|stored| {
            if let Some(session) = stored.sessions.get_mut(device_id) {
                session.address = Some(address);
            }
        })
    }

    /// Every unexpired session this device can dial. A fresher `address` from
    /// the server, when known, replaces the cached one.
    pub fn resumable(
        &self,
        now: i64,
        addresses: &HashMap<String, serde_json::Value>,
    ) -> Vec<ResumableSession> {
        let Ok(mut stored) = self.inner.lock() else {
            return Vec::new();
        };
        let mut changed = false;
        let mut sessions = Vec::new();
        for (device_id, session) in stored.sessions.iter_mut() {
            if let Some(address) = addresses.get(device_id) {
                if session.address.as_ref() != Some(address) {
                    session.address = Some(address.clone());
                    changed = true;
                }
            }
            let (Some(token), Some(address)) = (&session.outgoing_token, &session.address) else {
                continue;
            };
            if session.outgoing_expires_at <= now {
                continue;
            }
            sessions.push(ResumableSession {
                device_id: device_id.clone(),
                endpoint_id: session.peer_endpoint_id.clone(),
                token: token.clone(),
                expires_at: session.outgoing_expires_at,
                address: address.clone(),
            });
        }
        if changed {
            let _ = self.save(&stored);
        }
        sessions
    }

    pub fn summaries(&self) -> Vec<SessionSummary> {
        let Ok(stored) = self.inner.lock() else {
            return Vec::new();
        };
        stored
            .sessions
            .iter()
            .map(|(device_id, session)| SessionSummary {
                device_id: device_id.clone(),
                outgoing_expires_at: session
                    .outgoing_token
                    .as_ref()
                    .map_or(0, |_| session.outgoing_expires_at),
                incoming_expires_at: session
                    .incoming_token_hash
                    .as_ref()
                    .map_or(0, |_| session.incoming_expires_at),
            })
            .collect()
    }

    /// Ends both directions of the session with one device. The record stays,
    /// so the pair needs an explicit connect rather than reconnecting by itself.
    pub fn end(&self, device_id: &str) -> ApiResult<()> {
        self.update(|stored| {
            if let Some(session) = stored.sessions.get_mut(device_id) {
                session.outgoing_token = None;
                session.outgoing_expires_at = 0;
                session.incoming_token_hash = None;
                session.incoming_expires_at = 0;
            }
        })
    }

    /// Whether this device has ever had a session with the peer. A pair that
    /// never connected connects on its own; an ended one waits for the user.
    pub fn has_record(&self, device_id: &str) -> bool {
        self.inner
            .lock()
            .is_ok_and(|stored| stored.sessions.contains_key(device_id))
    }

    /// Keeps only devices that are still paired.
    pub fn retain(&self, paired: &[String]) -> ApiResult<()> {
        self.update(|stored| {
            stored
                .sessions
                .retain(|device_id, _| paired.contains(device_id));
            stored
                .consent
                .retain(|device_id, _| paired.contains(device_id));
        })
    }

    fn update(&self, change: impl FnOnce(&mut StoredSessions)) -> ApiResult<()> {
        let mut stored = self.inner.lock().map_err(lock_error)?;
        change(&mut stored);
        self.save(&stored)
    }

    fn save(&self, stored: &StoredSessions) -> ApiResult<()> {
        let scope = self.scope.lock().map_err(lock_error)?.clone();
        if scope.is_empty() {
            return Err(ApiError::Unavailable(
                "Connected Devices has not started.".to_owned(),
            ));
        }
        let encoded = serde_json::to_string(stored)?;
        credential_store::store(SESSION_SERVICE, &scope, &encoded)
            .map_err(|error| ApiError::Message(format!("Could not save device sessions: {error}")))
    }
}

fn session_for<'a>(
    stored: &'a mut StoredSessions,
    device_id: &str,
    endpoint_id: &str,
) -> &'a mut DeviceSession {
    let session = stored.sessions.entry(device_id.to_owned()).or_default();
    // A new endpoint is a new installation: nothing from the old one carries over.
    if session.peer_endpoint_id != endpoint_id {
        *session = DeviceSession {
            peer_endpoint_id: endpoint_id.to_owned(),
            ..DeviceSession::default()
        };
    }
    session
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> ApiError {
    ApiError::Unavailable("Device sessions are unavailable.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incoming_tokens_match_only_their_peer_and_lifetime() {
        let store = DeviceSessionStore::default();
        let token = new_token();
        store.inner.lock().unwrap().sessions.insert(
            "device_a".into(),
            DeviceSession {
                peer_endpoint_id: "endpoint_a".into(),
                incoming_token_hash: Some(token_hash(&token)),
                incoming_expires_at: 100,
                ..DeviceSession::default()
            },
        );
        assert_eq!(
            store.verify_incoming("device_a", "endpoint_a", &token, 50),
            Some(100)
        );
        assert_eq!(
            store.verify_incoming("device_a", "endpoint_a", &token, 100),
            None
        );
        assert_eq!(
            store.verify_incoming("device_a", "endpoint_b", &token, 50),
            None
        );
        assert_eq!(
            store.verify_incoming("device_a", "endpoint_a", "wrong", 50),
            None
        );
        assert_eq!(
            store.verify_incoming("device_b", "endpoint_a", &token, 50),
            None
        );
    }

    #[test]
    fn a_new_endpoint_replaces_the_old_session() {
        let mut stored = StoredSessions::default();
        session_for(&mut stored, "device_a", "endpoint_a").outgoing_token = Some("old".into());
        assert!(session_for(&mut stored, "device_a", "endpoint_b")
            .outgoing_token
            .is_none());
    }

    #[test]
    fn session_lengths_stay_within_bounds() {
        let store = DeviceSessionStore::default();
        assert_eq!(store.session_days(), DEFAULT_SESSION_DAYS);
        store.inner.lock().unwrap().session_days = Some(7);
        assert_eq!(store.expiry_from(0), 7 * DAY_SECONDS);
    }
}
