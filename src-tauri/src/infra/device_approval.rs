//! Approving a new device from one already added (docs/design/devices/BRIEF.md).
//! The new device commits to a nonce, the approver answers with an ephemeral
//! key and nonce, the new device reveals. Both show a six-digit code over the
//! whole exchange; a server that swaps any key changes the code. The approver
//! then seals the vault root to the new device with a key both derive from
//! that same exchange.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as XPublic, StaticSecret};
use zeroize::Zeroizing;

use crate::infra::{
    device_admission::{
        admit_self, fetch_trust, next_list, now, random32, refresh_trust, DeviceContext,
    },
    device_http::DeviceHttpError,
    device_identity::ADMISSION_DOMAIN,
    device_records::{grant_payload, ListMember, SignedRecord},
    device_trust,
};
use misty_browser_sync::crypto::VaultRoot;

/// Six digits over the whole exchange, shown on both devices.
pub(crate) fn comparison_code(transcript: &[u8]) -> String {
    let digest = Sha256::digest(transcript);
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

pub(crate) fn transcript(
    account_id: &str,
    request_id: &str,
    request_payload: &str,
    approver_x25519: &str,
    approver_nonce: &str,
    requester_nonce: &str,
) -> Vec<u8> {
    serde_json::to_vec(&(
        "misty.device.sas.v1",
        account_id,
        request_id,
        request_payload,
        approver_x25519,
        approver_nonce,
        requester_nonce,
    ))
    .unwrap_or_default()
}

pub(crate) fn seal_key(
    secret: &StaticSecret,
    peer_public: &[u8; 32],
    transcript: &[u8],
) -> Zeroizing<[u8; 32]> {
    let shared = Zeroizing::new(
        secret
            .diffie_hellman(&XPublic::from(*peer_public))
            .to_bytes(),
    );
    let mut key = Zeroizing::new([0u8; 32]);
    let salt = Sha256::digest(transcript);
    let _ = Hkdf::<Sha256>::new(Some(&salt), shared.as_ref())
        .expand(b"misty.device.root-seal.v1", key.as_mut());
    key
}

pub(crate) fn decode32(value: &str) -> Option<[u8; 32]> {
    STANDARD.decode(value).ok()?.try_into().ok()
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdmissionRecord {
    pub id: String,
    pub device_id: String,
    #[serde(default)]
    pub device_name: String,
    pub request_payload: String,
    pub request_signature: String,
    #[serde(default)]
    pub approver_device_id: String,
    #[serde(default)]
    pub approver_x25519_public: String,
    #[serde(default)]
    pub approver_nonce: String,
    #[serde(default)]
    pub requester_nonce: String,
    #[serde(default)]
    pub sealed_root: String,
    pub state: String,
}

struct RequesterState {
    secret: StaticSecret,
    nonce: [u8; 32],
    /// The exact request this device signed; the code covers it, not
    /// whatever the server echoes back.
    payload: String,
    revealed: bool,
}

static REQUESTER: OnceLock<Mutex<HashMap<String, RequesterState>>> = OnceLock::new();

fn requester_states() -> &'static Mutex<HashMap<String, RequesterState>> {
    REQUESTER.get_or_init(Default::default)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionView {
    pub request_id: String,
    pub state: String,
    pub code: Option<String>,
    pub device_name: String,
    pub admitted: bool,
}

/// Path B, on the new device: asks an added device to approve it.
pub async fn start_request(context: &DeviceContext) -> Result<AdmissionView, String> {
    let own = context.require_registered()?.to_owned();
    let secret = StaticSecret::from(random32());
    let public = STANDARD.encode(XPublic::from(&secret).as_bytes());
    let nonce = random32();
    let commitment = hex::encode(Sha256::digest(nonce));
    let payload = serde_json::to_vec(&(
        ADMISSION_DOMAIN,
        context.account(),
        &own,
        context.identity.public_key(),
        &public,
        &commitment,
        now(),
    ))
    .map_err(|error| error.to_string())?;
    let signature = context
        .identity
        .sign_record(&payload)
        .map_err(|error| error.to_string())?;
    let created: AdmissionRecord = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::POST,
            &format!("devices/{own}/admission-requests"),
            Some(&json!({"request": SignedRecord::new(&payload, signature)})),
        )
        .await?;
    requester_states()
        .lock()
        .map_err(|_| "Approval state is unavailable.")?
        .insert(
            created.id.clone(),
            RequesterState {
                secret,
                nonce,
                payload: STANDARD.encode(&payload),
                revealed: false,
            },
        );
    Ok(AdmissionView {
        request_id: created.id,
        state: created.state,
        ..Default::default()
    })
}

/// Path B, on the new device: follows the request, reveals the nonce once
/// challenged, shows the code, and opens the vault once approved.
pub async fn poll_request(
    context: &DeviceContext,
    app: tauri::AppHandle,
    api_base: &str,
    request_id: &str,
) -> Result<AdmissionView, String> {
    let (mut view, root) = poll_request_core(context, request_id).await?;
    let Some(root) = root else {
        return Ok(view);
    };
    crate::infra::browser_sync::open_with_transferred_root(
        app,
        api_base.to_owned(),
        context.account().to_owned(),
        root,
        true,
    )
    .await?;
    refresh_trust(context).await?;
    // Now that sync is open here, link this device's sync identity to its
    // grant so one name and removal cover both.
    let _ = admit_self(context).await;
    view.admitted = true;
    Ok(view)
}

/// Follows the request; once approved, returns the vault root it opened
/// (checked against the vault's root public key) for the caller to use.
pub(crate) async fn poll_request_core(
    context: &DeviceContext,
    request_id: &str,
) -> Result<(AdmissionView, Option<VaultRoot>), String> {
    let own = context.require_registered()?.to_owned();
    let record: AdmissionRecord = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::GET,
            &format!("devices/{own}/admission-requests/{request_id}"),
            None::<&()>,
        )
        .await?;
    let mut view = AdmissionView {
        request_id: record.id.clone(),
        state: record.state.clone(),
        ..Default::default()
    };
    if record.device_id != own {
        return Err("That approval belongs to another device.".to_owned());
    }
    // An ended request needs nothing from this device, even after a restart.
    if matches!(record.state.as_str(), "denied" | "expired") {
        forget_request(request_id);
        return Ok((view, None));
    }
    let (nonce, own_payload, needs_reveal) = {
        let states = requester_states()
            .lock()
            .map_err(|_| "Approval state is unavailable.")?;
        let state = states
            .get(request_id)
            .ok_or("Start the approval again from this device.")?;
        (
            state.nonce,
            state.payload.clone(),
            record.state == "challenged" && !state.revealed,
        )
    };
    if needs_reveal {
        let _: Value = context
            .http
            .signed(
                &context.identity,
                reqwest::Method::POST,
                &format!("devices/{own}/admission-requests/{request_id}/reveal"),
                Some(&json!({"nonce": STANDARD.encode(nonce)})),
            )
            .await?;
        if let Some(state) = requester_states()
            .lock()
            .map_err(|_| "Approval state is unavailable.")?
            .get_mut(request_id)
        {
            state.revealed = true;
        }
        view.state = "revealed".to_owned();
    }
    if record.approver_x25519_public.is_empty() {
        return Ok((view, None));
    }
    let script = transcript(
        context.account(),
        &record.id,
        &own_payload,
        &record.approver_x25519_public,
        &record.approver_nonce,
        &STANDARD.encode(nonce),
    );
    view.code = Some(comparison_code(&script));
    if record.state != "approved" || record.sealed_root.is_empty() {
        return Ok((view, None));
    }
    let sealed = STANDARD
        .decode(&record.sealed_root)
        .map_err(|_| "The approval was damaged.")?;
    let approver_public =
        decode32(&record.approver_x25519_public).ok_or("The approval was damaged.")?;
    if sealed.len() < 12 + 16 {
        return Err("The approval was damaged.".to_owned());
    }
    let root_bytes = {
        let states = requester_states()
            .lock()
            .map_err(|_| "Approval state is unavailable.")?;
        let state = states
            .get(request_id)
            .ok_or("Start the approval again from this device.")?;
        let key = seal_key(&state.secret, &approver_public, &script);
        let cipher =
            Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "The approval was damaged.")?;
        Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&sealed[..12]),
                    Payload {
                        msg: &sealed[12..],
                        aad: &script,
                    },
                )
                .map_err(|_| "The approval didn't come from the device you confirmed.")?,
        )
    };
    let (vault, _) = fetch_trust(context).await?;
    let root = VaultRoot::from_transfer(&root_bytes, &vault.root_public_key)
        .map_err(|_| "The approval named a different sync vault.")?;
    device_trust::pin_root(&vault.root_public_key, &vault.vault_id)
        .map_err(|error| error.to_string())?;
    requester_states()
        .lock()
        .map_err(|_| "Approval state is unavailable.")?
        .remove(request_id);
    Ok((view, Some(root)))
}

/// Forgets this device's side of an approval that ended.
pub(crate) fn forget_request(request_id: &str) {
    if let Ok(mut states) = requester_states().lock() {
        states.remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_devices_derive_the_same_code_and_seal_key_from_one_exchange() {
        let requester = StaticSecret::from(random32());
        let approver = StaticSecret::from(random32());
        let requester_public = *XPublic::from(&requester).as_bytes();
        let approver_public = *XPublic::from(&approver).as_bytes();
        let script = transcript(
            "acct",
            "admission_1",
            "payload",
            &STANDARD.encode(approver_public),
            "a",
            "r",
        );
        assert_eq!(
            seal_key(&approver, &requester_public, &script).as_ref(),
            seal_key(&requester, &approver_public, &script).as_ref()
        );
        let code = comparison_code(&script);
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|b| b.is_ascii_digit()));
        // Any substituted part changes the code and the key.
        let swapped = transcript(
            "acct",
            "admission_1",
            "other payload",
            &STANDARD.encode(approver_public),
            "a",
            "r",
        );
        assert_ne!(
            seal_key(&approver, &requester_public, &script).as_ref(),
            seal_key(&approver, &requester_public, &swapped).as_ref()
        );
        let intruder = StaticSecret::from(random32());
        assert_ne!(
            seal_key(&intruder, &requester_public, &script).as_ref(),
            seal_key(&requester, &approver_public, &script).as_ref()
        );
    }
}
