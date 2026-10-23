//! The exchange both devices compute: the comparison code, the transcript it
//! covers and the key the vault root is sealed with.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as XPublic, StaticSecret};
use zeroize::Zeroizing;

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
