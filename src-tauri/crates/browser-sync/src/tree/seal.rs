//! Per-node authenticated encryption and op signatures for the tree protocol.
//!
//! Each node or slot is AES-256-GCM encrypted with associated data binding it
//! to `(workspace, tree, node, parent, slot, version, key_epoch)`. The server
//! cannot move a node to another parent, tree or version, or replay a slot
//! onto another tab, without decryption failing on every client.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

use super::{
    codec::{self, Padding},
    protocol::{TreeChange, TreeClaim, TreeOp},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    protocol::{decode_fixed, valid_id, DeviceGrant},
    Error, Result,
};

/// Slot 0 names a node; 1..=16 are per-tab slots.
#[derive(Clone, Copy)]
pub struct Position<'a> {
    pub tree_id: &'a str,
    pub node_id: &'a str,
    pub parent_id: Option<&'a str>,
    pub slot: i16,
    pub version: u64,
    pub key_epoch: u64,
}

fn aad(scope: &VaultScope, at: Position<'_>) -> Result<Vec<u8>> {
    if !valid_id(at.tree_id) || !valid_id(at.node_id) || at.parent_id.is_some_and(|p| !valid_id(p)) || at.version == 0 {
        return Err(Error::Invalid);
    }
    scope.aad(
        "misty.sync.tree-node.v2",
        &(at.tree_id, at.node_id, at.parent_id.unwrap_or(""), at.slot, at.version, at.key_epoch),
    )
}

fn tree_key(root: &VaultRoot, scope: &VaultScope, key_epoch: u64) -> Result<Zeroizing<[u8; 32]>> {
    root.derive("misty.sync.tree-key.v2", &(&scope.workspace_id, key_epoch))
}

/// Returns `nonce || ciphertext`, the byte layout the server stores.
pub fn seal(root: &VaultRoot, scope: &VaultScope, at: Position<'_>, plaintext: &[u8]) -> Result<Vec<u8>> {
    let padding = if at.slot == 0 { Padding::Node } else { Padding::Bucket };
    let frame = Zeroizing::new(codec::encode(plaintext, padding)?);
    let key = tree_key(root, scope, at.key_epoch)?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let sealed = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| Error::Invalid)?
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: &frame, aad: &aad(scope, at)? })
        .map_err(|_| Error::Unlock)?;
    let mut out = Vec::with_capacity(12 + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub fn open(root: &VaultRoot, scope: &VaultScope, at: Position<'_>, sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if sealed.len() < 28 {
        return Err(Error::Invalid);
    }
    let key = tree_key(root, scope, at.key_epoch)?;
    let frame = Zeroizing::new(
        Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| Error::Invalid)?
            .decrypt(Nonce::from_slice(&sealed[..12]), Payload { msg: &sealed[12..], aad: &aad(scope, at)? })
            .map_err(|_| Error::Identity)?,
    );
    Ok(Zeroizing::new(codec::decode(&frame)?))
}

/// Keyed favicon hash: identical content dedupes within one vault only.
pub fn blob_hash(root: &VaultRoot, scope: &VaultScope, content: &[u8]) -> Result<[u8; 32]> {
    use hkdf::hmac::{Hmac, Mac};
    let key = root.derive("misty.sync.blob-hash.v2", &scope.workspace_id)?;
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(key.as_ref()).map_err(|_| Error::Invalid)?;
    mac.update(content);
    Ok(mac.finalize().into_bytes().into())
}

pub fn sign_op(device: &DeviceKey, op: &mut TreeOp) -> Result<()> {
    op.signature = STANDARD.decode(device.sign(&op.signing_bytes()?)).map_err(|_| Error::Invalid)?;
    Ok(())
}

pub fn sign_claim(device: &DeviceKey, claim: &mut TreeClaim) -> Result<()> {
    claim.signature = STANDARD.decode(device.sign(&claim.signing_bytes()?)).map_err(|_| Error::Invalid)?;
    Ok(())
}

/// Verifies a change-feed entry against the author's vault-signed grant.
/// Grant authenticity itself is checked by `VaultRoot::verify_grant`.
pub fn verify_change(
    root: &VaultRoot,
    scope: &VaultScope,
    tree_id: &str,
    grant: &DeviceGrant,
    change: &TreeChange,
) -> Result<()> {
    root.verify_grant(scope, grant)?;
    if grant.device_id != change.device_id || grant.key_epoch != change.key_epoch || change.signature.len() != 64 {
        return Err(Error::Identity);
    }
    let public = VerifyingKey::from_bytes(&decode_fixed(&grant.public_key)?).map_err(|_| Error::Identity)?;
    let signature = Signature::from_slice(&change.signature).map_err(|_| Error::Identity)?;
    public
        .verify_strict(&change.signing_bytes(&scope.workspace_id, tree_id)?, &signature)
        .map_err(|_| Error::Identity)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> VaultScope {
        VaultScope {
            deployment: "https://sync.example.test".into(),
            account_id: "account".into(),
            workspace_id: "01951d32-40ac-7000-8000-000000000001".into(),
        }
    }
    const TREE: &str = "01951d32-40ac-7000-8000-000000000002";
    const NODE: &str = "01951d32-40ac-7000-8000-000000000003";
    const OTHER: &str = "01951d32-40ac-7000-8000-000000000004";

    fn at(parent: Option<&'static str>, version: u64) -> Position<'static> {
        Position { tree_id: TREE, node_id: NODE, parent_id: parent, slot: 0, version, key_epoch: 1 }
    }

    #[test]
    fn nodes_are_bound_to_their_position() {
        let root = VaultRoot::generate();
        let sealed = seal(&root, &scope(), at(Some(TREE), 3), b"tab").unwrap();
        assert_eq!(open(&root, &scope(), at(Some(TREE), 3), &sealed).unwrap().as_slice(), b"tab");
        // Moved to another parent, rolled back to another version, or replayed
        // into another tree: all fail authentication.
        assert!(open(&root, &scope(), at(Some(OTHER), 3), &sealed).is_err());
        assert!(open(&root, &scope(), at(Some(TREE), 2), &sealed).is_err());
        let mut moved = at(Some(TREE), 3);
        moved.tree_id = OTHER;
        assert!(open(&root, &scope(), moved, &sealed).is_err());
        let mut slot = at(Some(TREE), 3);
        slot.slot = 2;
        assert!(open(&root, &scope(), slot, &sealed).is_err());
        assert!(open(&VaultRoot::generate(), &scope(), at(Some(TREE), 3), &sealed).is_err());
    }

    #[test]
    fn blob_hashes_are_keyed_per_vault() {
        let (a, b) = (VaultRoot::generate(), VaultRoot::generate());
        assert_eq!(blob_hash(&a, &scope(), b"icon").unwrap(), blob_hash(&a, &scope(), b"icon").unwrap());
        assert_ne!(blob_hash(&a, &scope(), b"icon").unwrap(), blob_hash(&b, &scope(), b"icon").unwrap());
    }
}
