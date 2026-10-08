//! `webauthn`: passkeys and security keys behind `navigator.credentials`,
//! where the engine cannot reach the OS authenticator for arbitrary sites
//! (WKWebView without Safari's entitlement path). This module decides what a
//! page may ask for and shapes the replies; an `Authenticator` per platform
//! runs the ceremony with the caller's real origin.

mod attestation;
#[cfg(all(target_os = "macos", feature = "tauri"))]
pub mod macos;
mod options;

use super::{ready, Call, Capability, Reply};
use crate::{Host, KiriError};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::{future::Future, pin::Pin, sync::Arc};

/// Installed only where an `Authenticator` is available (see `capabilities::shims`).
#[cfg_attr(not(all(target_os = "macos", feature = "tauri")), allow(dead_code))]
pub(crate) const SHIM: &str = include_str!("shim.js");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attachment {
    Platform,
    CrossPlatform,
}

impl Attachment {
    fn as_str(self) -> &'static str {
        match self {
            Attachment::Platform => "platform",
            Attachment::CrossPlatform => "cross-platform",
        }
    }
}

#[derive(Clone, Debug)]
pub struct CreateRequest {
    /// The caller's origin, as Kiri established it.
    pub origin: String,
    pub rp_id: String,
    pub challenge: Vec<u8>,
    pub user_id: Vec<u8>,
    pub user_name: String,
    pub user_display_name: String,
    /// COSE algorithms, in the page's order of preference.
    pub algorithms: Vec<i64>,
    pub exclude: Vec<Vec<u8>>,
    pub attachment: Option<Attachment>,
    /// "required", "preferred" or "discouraged".
    pub resident_key: String,
    /// "required", "preferred" or "discouraged".
    pub user_verification: String,
    /// "none", "indirect", "direct" or "enterprise".
    pub attestation: String,
}

#[derive(Clone, Debug)]
pub struct GetRequest {
    pub origin: String,
    pub rp_id: String,
    pub challenge: Vec<u8>,
    pub allow: Vec<Vec<u8>>,
    pub user_verification: String,
}

#[derive(Clone, Debug)]
pub struct Registration {
    pub credential_id: Vec<u8>,
    pub client_data_json: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub attachment: Attachment,
    pub transports: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Assertion {
    pub credential_id: Vec<u8>,
    pub client_data_json: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
    pub user_handle: Option<Vec<u8>>,
    pub attachment: Attachment,
}

pub type Ceremony<T> = Pin<Box<dyn Future<Output = Result<T, KiriError>> + Send>>;

/// The OS side of a ceremony. The OS shows its own sheet, which is the
/// user's consent; Kiri has already checked the relying party.
pub trait Authenticator: Send + Sync + 'static {
    fn create(&self, request: CreateRequest, host: Arc<dyn Host>) -> Ceremony<Registration>;
    fn get(&self, request: GetRequest, host: Arc<dyn Host>) -> Ceremony<Assertion>;
    fn cancel(&self, host: Arc<dyn Host>);
}

pub struct WebAuthn<A> {
    authenticator: Arc<A>,
}

impl<A: Authenticator> WebAuthn<A> {
    pub fn new(authenticator: A) -> Self {
        Self {
            authenticator: Arc::new(authenticator),
        }
    }
}

fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn registration_json(registration: Registration) -> Value {
    let attested = attestation::read(&registration.attestation_object);
    let id = encode(&registration.credential_id);
    json!({
        "id": id,
        "rawId": id,
        "type": "public-key",
        "authenticatorAttachment": registration.attachment.as_str(),
        "response": {
            "clientDataJSON": encode(&registration.client_data_json),
            "attestationObject": encode(&registration.attestation_object),
            "authenticatorData": attested.as_ref().map(|a| encode(&a.authenticator_data)),
            "publicKey": attested.as_ref().and_then(|a| a.public_key.as_deref()).map(encode),
            "publicKeyAlgorithm": attested.as_ref().and_then(|a| a.algorithm),
            "transports": registration.transports,
        },
        "clientExtensionResults": {},
    })
}

fn assertion_json(assertion: Assertion) -> Value {
    let id = encode(&assertion.credential_id);
    json!({
        "id": id,
        "rawId": id,
        "type": "public-key",
        "authenticatorAttachment": assertion.attachment.as_str(),
        "response": {
            "clientDataJSON": encode(&assertion.client_data_json),
            "authenticatorData": encode(&assertion.authenticator_data),
            "signature": encode(&assertion.signature),
            "userHandle": assertion.user_handle.as_deref().map(encode),
        },
        "clientExtensionResults": {},
    })
}

impl<A: Authenticator> Capability for WebAuthn<A> {
    fn name(&self) -> &'static str {
        "webauthn"
    }

    fn call(&self, call: Call) -> Reply {
        let authenticator = self.authenticator.clone();
        match call.method.as_str() {
            "create" => match options::create(&call.caller, call.args) {
                Ok(request) => {
                    let ceremony = authenticator.create(request, call.host);
                    Box::pin(async move { ceremony.await.map(registration_json) })
                }
                Err(error) => ready(Err(error)),
            },
            "get" => match options::get(&call.caller, call.args) {
                Ok(request) => {
                    let ceremony = authenticator.get(request, call.host);
                    Box::pin(async move { ceremony.await.map(assertion_json) })
                }
                Err(error) => ready(Err(error)),
            },
            "cancel" => {
                authenticator.cancel(call.host);
                ready(Ok(Value::Null))
            }
            other => ready(Err(KiriError::not_supported(format!("webauthn.{other} does not exist.")))),
        }
    }
}

#[cfg(test)]
mod tests;
