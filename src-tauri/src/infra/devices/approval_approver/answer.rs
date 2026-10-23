//! The approver's answer once the person compared codes: approving signs the
//! grant and list and seals the vault root; denying ends the request.
use super::*;

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
                trust::apply_server_list(Some(&new_list)).map_err(|error| error.to_string())?;
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
