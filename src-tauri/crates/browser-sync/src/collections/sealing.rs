//! Sealing and opening single records with the vault key.
use aes_gcm::{
    aead::{Aead, AeadCore, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rand::rngs::OsRng;

use super::{CLIPBOARD, COLLECTIONS};
use crate::{
    crypto::{VaultRoot, VaultScope},
    document::ViewRecord,
    Error, Result,
};

fn known(collection: &str) -> Result<()> {
    if COLLECTIONS.contains(&collection) {
        Ok(())
    } else {
        Err(Error::Invalid)
    }
}

/// The opaque id the server stores for a record: hex HMAC of its real id.
pub fn record_key(
    root: &VaultRoot,
    scope: &VaultScope,
    collection: &str,
    id: &str,
) -> Result<String> {
    use hkdf::hmac::{Hmac, Mac};
    if collection != CLIPBOARD {
        known(collection)?;
    }
    let key = root.derive("misty.sync.record-id.v1", &(&scope.vault_id, collection))?;
    let mut mac =
        <Hmac<sha2::Sha256> as Mac>::new_from_slice(key.as_ref()).map_err(|_| Error::Invalid)?;
    mac.update(id.as_bytes());
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn cipher(root: &VaultRoot, scope: &VaultScope, collection: &str) -> Result<Aes256Gcm> {
    let key = root.derive("misty.sync.record-key.v1", &(&scope.vault_id, collection))?;
    Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| Error::Invalid)
}

fn aad(scope: &VaultScope, collection: &str, key: &str, version: u64) -> Result<Vec<u8>> {
    if version == 0 {
        return Err(Error::Invalid);
    }
    scope.aad("misty.sync.record.v1", &(collection, key, version))
}

/// `nonce || ciphertext` for `record` stored as `version`.
pub fn seal(
    root: &VaultRoot,
    scope: &VaultScope,
    collection: &str,
    version: u64,
    record: &ViewRecord,
) -> Result<Vec<u8>> {
    let key = record_key(root, scope, collection, &record.id)?;
    let plain = zeroize::Zeroizing::new(serde_json::to_vec(record)?);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let sealed = cipher(root, scope, collection)?
        .encrypt(
            &nonce,
            Payload {
                msg: &plain,
                aad: &aad(scope, collection, &key, version)?,
            },
        )
        .map_err(|_| Error::Unlock)?;
    let mut out = Vec::with_capacity(12 + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens a record read from the server and checks it is the record the
/// server filed it under.
pub fn open(
    root: &VaultRoot,
    scope: &VaultScope,
    collection: &str,
    key: &str,
    version: u64,
    sealed: &[u8],
) -> Result<ViewRecord> {
    if sealed.len() < 28 {
        return Err(Error::Invalid);
    }
    let plain = zeroize::Zeroizing::new(
        cipher(root, scope, collection)?
            .decrypt(
                Nonce::from_slice(&sealed[..12]),
                Payload {
                    msg: &sealed[12..],
                    aad: &aad(scope, collection, key, version)?,
                },
            )
            .map_err(|_| Error::Identity)?,
    );
    let record: ViewRecord = serde_json::from_slice(&plain)?;
    if record_key(root, scope, collection, &record.id)? != key {
        return Err(Error::Identity);
    }
    Ok(record)
}
