//! The key that seals workspace recovery on this computer, and sealing with it.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{Error, Result};

const MAX_LOCAL_BYTES: usize = 32 << 20;

mod records;

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

/// Whose recovery a key seals: the deployment and account come from native configuration, never a
/// remotely supplied event or embedded webpage, and `id` names the store.
#[derive(Clone)]
pub struct RecoveryScope {
    pub deployment: String,
    pub account_id: String,
    pub id: String,
}

impl RecoveryScope {
    pub fn validate(&self) -> Result<()> {
        if self.deployment.is_empty()
            || self.deployment.len() > 2048
            || self.account_id.is_empty()
            || self.account_id.len() > 1024
            || !valid_id(&self.id)
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
            &self.id,
            identity,
        ))?)
    }
}

pub struct RecoveryKey(Zeroizing<[u8; 32]>);

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

impl RecoveryKey {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random()))
    }

    /// A second handle to the same key.
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
}
