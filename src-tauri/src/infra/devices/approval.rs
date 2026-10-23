//! Approving a new device from one already added (docs/sync/devices.md).
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
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as XPublic, StaticSecret};
use zeroize::Zeroizing;

use super::{
    admission::{admit_self, fetch_trust, now, random32, refresh_trust, DeviceContext},
    identity::ADMISSION_DOMAIN,
    records::SignedRecord,
    trust,
};
use misty_browser_sync::crypto::VaultRoot;

mod exchange;
pub(crate) use exchange::{comparison_code, decode32, seal_key, transcript};

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
    trust::pin_root(&vault.root_public_key, &vault.vault_id).map_err(|error| error.to_string())?;
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
mod tests;
