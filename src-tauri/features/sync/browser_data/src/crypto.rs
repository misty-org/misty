//! The vault root, a session's signing key, and sealing with them.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{Error, Result};

const MAX_LOCAL_BYTES: usize = 32 << 20;

mod clipboard;
mod device;
mod records;
pub use clipboard::MAX_SEALED_CLIP_BYTES;

pub(crate) fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|u| !u.is_nil() && u.to_string() == id)
}

pub(crate) fn decode_fixed<const N: usize>(s: &str) -> Result<[u8; N]> {
    if s.len() != N.div_ceil(3) * 4 {
        return Err(Error::Invalid);
    }
    let bytes = Zeroizing::new(STANDARD.decode(s).map_err(|_| Error::Invalid)?);
    bytes.as_slice().try_into().map_err(|_| Error::Invalid)
}

/// Sealed data kept on this computer.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub version: u8,
    pub nonce: String,
    pub ciphertext: String,
}

impl Envelope {
    pub(crate) fn decode(&self, limit: usize) -> Result<([u8; 12], Vec<u8>)> {
        if self.version != 1 || self.ciphertext.len() > limit.div_ceil(3) * 4 {
            return Err(Error::Invalid);
        }
        let nonce = decode_fixed(&self.nonce)?;
        let bytes = STANDARD
            .decode(&self.ciphertext)
            .map_err(|_| Error::Invalid)?;
        if bytes.len() < 16 || bytes.len() > limit {
            return Err(Error::Invalid);
        }
        Ok((nonce, bytes))
    }
}

/// Canonical deployment and account identity come from authenticated native
/// configuration, never a remotely supplied event or embedded webpage.
#[derive(Clone)]
pub struct VaultScope {
    pub deployment: String,
    pub account_id: String,
    pub vault_id: String,
}

impl VaultScope {
    pub fn validate(&self) -> Result<()> {
        if self.deployment.is_empty()
            || self.deployment.len() > 2048
            || self.account_id.is_empty()
            || self.account_id.len() > 1024
            || !valid_id(&self.vault_id)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }

    pub(crate) fn aad(&self, domain: &str, identity: &impl serde::Serialize) -> Result<Vec<u8>> {
        self.validate()?;
        Ok(serde_json::to_vec(&(
            domain,
            &self.deployment,
            &self.account_id,
            &self.vault_id,
            identity,
        ))?)
    }
}

pub struct VaultRoot(Zeroizing<[u8; 32]>);
#[derive(Clone)]
pub struct DeviceKey(Zeroizing<[u8; 32]>);

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn cipher(key: &[u8]) -> Result<Aes256Gcm> {
    Aes256Gcm::new_from_slice(key).map_err(|_| Error::Invalid)
}

fn encrypt(key: &[u8], plaintext: &[u8], aad: &[u8], limit: usize) -> Result<Envelope> {
    if plaintext.len() > limit - 16 {
        return Err(Error::TooLarge);
    }
    let nonce = random::<12>();
    let ciphertext = cipher(key)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| Error::Unlock)?;
    Ok(Envelope {
        version: 1,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

fn decrypt(
    key: &[u8],
    envelope: &Envelope,
    aad: &[u8],
    limit: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    let (nonce, ciphertext) = envelope.decode(limit)?;
    cipher(key)?
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| Error::Unlock)
}

impl VaultRoot {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random()))
    }

    /// A second handle to the same root, kept only while the vault is open.
    pub fn duplicate(&self) -> Self {
        Self(Zeroizing::new(*self.0))
    }

    pub(crate) fn protected_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub(crate) fn from_protected(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != 32 {
            return Err(Error::Invalid);
        }
        let mut root = Zeroizing::new([0; 32]);
        root.copy_from_slice(bytes);
        Ok(Self(root))
    }

    pub(crate) fn derive(
        &self,
        domain: &str,
        identity: &impl serde::Serialize,
    ) -> Result<Zeroizing<[u8; 32]>> {
        let info = serde_json::to_vec(&(domain, identity))?;
        let mut key = Zeroizing::new([0; 32]);
        Hkdf::<Sha256>::new(Some(b"misty.sync.hkdf.v1"), self.0.as_ref())
            .expand(&info, key.as_mut())
            .map_err(|_| Error::Invalid)?;
        Ok(key)
    }

    /// The key that seals the shared clipboard's clips for a vault's sessions.
    pub fn vault_clipboard_key(&self, vault_id: &str) -> Result<ClipboardKey> {
        Ok(ClipboardKey(
            self.derive("misty.vault.clipboard.v1", &vault_id)?,
        ))
    }

    /// Signs a vault operation: a change of its sealed root, admitting or removing a session, or
    /// destroying it. Callers name their purpose in the first element of the payload.
    pub(crate) fn sign_domain(&self, payload: &[u8]) -> Result<Vec<u8>> {
        Ok(self.signing_key()?.sign(payload).to_bytes().to_vec())
    }

    fn signing_key(&self) -> Result<SigningKey> {
        let seed = self.derive("misty.sync.root-signing.v1", &1)?;
        Ok(SigningKey::from_bytes(&seed))
    }

    pub fn public_key(&self) -> Result<String> {
        Ok(STANDARD.encode(self.signing_key()?.verifying_key().as_bytes()))
    }
}

/// Seals clips in the shared clipboard's ring. A sealed clip is a 12-byte
/// nonce followed by the AES-256-GCM ciphertext. The associated data binds it
/// to its ring slot, so a clip cannot be moved to another slot; the key binds
/// it to the vault.
pub struct ClipboardKey(Zeroizing<[u8; 32]>);

#[cfg(test)]
mod clipboard_key_tests;
