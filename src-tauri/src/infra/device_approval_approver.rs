//! Approving a new device, on a device already added (docs/design/devices/BRIEF.md):
//! verify the request, answer it once, check the reveal against the
//! commitment, show the code, and only after the person confirms it, sign the
//! grant and list and seal the vault root to the new device.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as XPublic, StaticSecret};

use crate::infra::{
    device_admission::{admission_authority, fetch_trust, next_list, now, random32, DeviceContext},
    device_approval::{
        comparison_code, decode32, forget_request, seal_key, transcript, AdmissionRecord,
        AdmissionView,
    },
    device_http::DeviceHttpError,
    device_identity::ADMISSION_DOMAIN,
    device_records::{grant_payload, ListMember, SignedRecord},
    device_trust,
};

struct ApproverState {
    secret: StaticSecret,
    nonce: [u8; 32],
    request: AdmissionRecord,
    requester_public_key: String,
    requester_x25519: [u8; 32],
    code: Option<String>,
}

static APPROVER: OnceLock<Mutex<HashMap<String, ApproverState>>> = OnceLock::new();

fn approver_states() -> &'static Mutex<HashMap<String, ApproverState>> {
    APPROVER.get_or_init(Default::default)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequestView {
    pub request_id: String,
    pub device_id: String,
    pub device_name: String,
    pub state: String,
}

pub async fn list_requests(context: &DeviceContext) -> Result<Vec<PendingRequestView>, String> {
    #[derive(Deserialize)]
    struct Response {
        requests: Vec<AdmissionRecord>,
    }
    let response: Response = context
        .http
        .session(
            reqwest::Method::GET,
            "devices/admission-requests",
            None::<&()>,
        )
        .await?;
    Ok(response
        .requests
        .into_iter()
        .map(|request| PendingRequestView {
            request_id: request.id,
            device_id: request.device_id,
            device_name: request.device_name,
            state: request.state,
        })
        .collect())
}

/// Path B, on an added device: verifies the request and answers it.
pub async fn challenge(context: &DeviceContext, request_id: &str) -> Result<AdmissionView, String> {
    let own = context.require_registered()?.to_owned();
    if admission_authority(context).await.is_none() {
        return Err("Unlock sync on this device to approve another.".to_owned());
    }
    let record: AdmissionRecord = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::GET,
            &format!("devices/{own}/admission-requests/{request_id}"),
            None::<&()>,
        )
        .await?;
    let record_signed = SignedRecord {
        payload: record.request_payload.clone(),
        signature: record.request_signature.clone(),
    };
    let bytes = record_signed.bytes().ok_or("The request was damaged.")?;
    let fields: Vec<Value> =
        serde_json::from_slice(&bytes).map_err(|_| "The request was damaged.")?;
    let field = |index: usize| {
        fields
            .get(index)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let (domain, account, device, public_key, x25519) =
        (field(0), field(1), field(2), field(3), field(4));
    if domain != ADMISSION_DOMAIN
        || account != context.account()
        || device != record.device_id
        || !crate::infra::device_identity::verify_device_signature(
            &public_key,
            &bytes,
            &record.request_signature,
        )
    {
        return Err("The request didn't verify.".to_owned());
    }
    let requester_x25519 = decode32(&x25519).ok_or("The request didn't verify.")?;
    let secret = StaticSecret::from(random32());
    let public = STANDARD.encode(XPublic::from(&secret).as_bytes());
    let nonce = random32();
    let _: Value = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::POST,
            &format!("devices/{own}/admission-requests/{request_id}/challenge"),
            Some(&json!({"x25519Public": public, "nonce": STANDARD.encode(nonce)})),
        )
        .await?;
    let name = record.device_name.clone();
    approver_states()
        .lock()
        .map_err(|_| "Approval state is unavailable.")?
        .insert(
            request_id.to_owned(),
            ApproverState {
                secret,
                nonce,
                request: record,
                requester_public_key: public_key,
                requester_x25519,
                code: None,
            },
        );
    Ok(AdmissionView {
        request_id: request_id.to_owned(),
        state: "challenged".to_owned(),
        device_name: name,
        ..Default::default()
    })
}

/// Path B, on the approver: once the new device revealed its nonce, checks it
/// against the commitment and shows the code.
pub async fn approver_poll(
    context: &DeviceContext,
    request_id: &str,
) -> Result<AdmissionView, String> {
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
    let mut states = approver_states()
        .lock()
        .map_err(|_| "Approval state is unavailable.")?;
    let state = states
        .get_mut(request_id)
        .ok_or("Start this approval again.")?;
    let mut view = AdmissionView {
        request_id: request_id.to_owned(),
        state: record.state.clone(),
        device_name: state.request.device_name.clone(),
        ..Default::default()
    };
    if record.state != "revealed" || record.approver_device_id != own {
        return Ok(view);
    }
    let bytes = SignedRecord {
        payload: state.request.request_payload.clone(),
        signature: String::new(),
    }
    .bytes()
    .ok_or("The request was damaged.")?;
    let fields: Vec<Value> =
        serde_json::from_slice(&bytes).map_err(|_| "The request was damaged.")?;
    let commitment = fields
        .get(5)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let revealed = STANDARD
        .decode(&record.requester_nonce)
        .map_err(|_| "The request was damaged.")?;
    if hex::encode(Sha256::digest(&revealed)) != commitment {
        return Err("The new device's answer didn't match. Deny this request.".to_owned());
    }
    let script = transcript(
        context.account(),
        request_id,
        &state.request.request_payload,
        &STANDARD.encode(XPublic::from(&state.secret).as_bytes()),
        &STANDARD.encode(state.nonce),
        &record.requester_nonce,
    );
    let code = comparison_code(&script);
    state.code = Some(code.clone());
    state.request.requester_nonce = record.requester_nonce;
    view.code = Some(code);
    Ok(view)
}

/// Path B, on the approver, after the person confirmed matching codes: signs
/// the grant and list and seals the vault root to the new device.
pub async fn approve(context: &DeviceContext, request_id: &str) -> Result<(), String> {
    let own = context.require_registered()?.to_owned();
    let (root, _, _) = admission_authority(context)
        .await
        .ok_or("Unlock sync on this device to approve another.")?;
    let (request, requester_public_key, script, sealed) = {
        let states = approver_states()
            .lock()
            .map_err(|_| "Approval state is unavailable.")?;
        let state = states.get(request_id).ok_or("Start this approval again.")?;
        if state.code.is_none() {
            return Err("Compare the codes before approving.".to_owned());
        }
        let script = transcript(
            context.account(),
            request_id,
            &state.request.request_payload,
            &STANDARD.encode(XPublic::from(&state.secret).as_bytes()),
            &STANDARD.encode(state.nonce),
            &state.request.requester_nonce,
        );
        let key = seal_key(&state.secret, &state.requester_x25519, &script);
        let cipher =
            Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "Couldn't seal the vault key.")?;
        let mut nonce = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let root_bytes = root.transfer_bytes();
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: root_bytes.as_ref(),
                    aad: &script,
                },
            )
            .map_err(|_| "Couldn't seal the vault key.")?;
        let mut sealed = nonce.to_vec();
        sealed.extend_from_slice(&ciphertext);
        (
            state.request.clone(),
            state.requester_public_key.clone(),
            script,
            STANDARD.encode(sealed),
        )
    };
    let _ = script;
    for attempt in 0..2 {
        let (vault, list) = fetch_trust(context).await?;
        if vault.root_public_key != root.public_key().map_err(|error| error.to_string())? {
            return Err("Misty named a different sync vault than this device holds.".to_owned());
        }
        let grant = grant_payload(
            context.account(),
            &vault.vault_id,
            &request.device_id,
            vault.key_epoch,
            &requester_public_key,
            "",
            now(),
            &own,
        )
        .map_err(|error| error.to_string())?;
        let grant = SignedRecord::new(
            &grant,
            root.sign_device_record(&grant)
                .map_err(|error| error.to_string())?,
        );
        let member = ListMember {
            device_id: request.device_id.clone(),
            public_key: requester_public_key.clone(),
        };
        let new_list = next_list(
            context.account(),
            &vault,
            list.as_ref(),
            Some(member),
            None,
            &root,
        )?;
        let result: Result<Value, DeviceHttpError> = context
            .http
            .signed(
                &context.identity,
                reqwest::Method::POST,
                &format!("devices/{own}/admission-requests/{request_id}/approve"),
                Some(&json!({"grant": grant, "list": new_list, "sealedRoot": sealed})),
            )
            .await;
        match result {
            Ok(_) => {
                approver_states()
                    .lock()
                    .map_err(|_| "Approval state is unavailable.")?
                    .remove(request_id);
                device_trust::apply_server_list(Some(&new_list))
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
            Err(DeviceHttpError::Status(409, code))
                if code == "device_list_conflict" && attempt == 0 =>
            {
                continue
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Your devices changed while approving. Try again.".to_owned())
}

pub async fn deny(context: &DeviceContext, request_id: &str) -> Result<(), String> {
    let own = context.require_registered()?.to_owned();
    let _: Value = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::POST,
            &format!("devices/{own}/admission-requests/{request_id}/deny"),
            None::<&()>,
        )
        .await?;
    if let Ok(mut states) = approver_states().lock() {
        states.remove(request_id);
    }
    forget_request(request_id);
    Ok(())
}
