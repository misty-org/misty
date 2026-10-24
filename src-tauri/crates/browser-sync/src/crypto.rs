use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{protocol::*, Error, Result};

const MAX_LOCAL_BYTES: usize = 32 << 20;

mod clipboard;
mod device;
mod records;
mod unlock;
pub use clipboard::MAX_SEALED_CLIP_BYTES;

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

pub fn generate_sync_secret() -> Zeroizing<String> {
    let secret = Zeroizing::new(random::<32>());
    Zeroizing::new(STANDARD.encode(secret.as_ref()))
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

fn wrapping_key(password: &str, secret: &str, salt: &[u8; 16]) -> Result<Zeroizing<[u8; 32]>> {
    if !(12..=1024).contains(&password.len()) {
        return Err(Error::Invalid);
    }
    let secret = Zeroizing::new(decode_fixed::<32>(secret)?);
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| Error::Invalid)?;
    let mut memory = Zeroizing::new(vec![argon2::Block::default(); params.block_count()]);
    let argon =
        Argon2::new_with_secret(secret.as_ref(), Algorithm::Argon2id, Version::V0x13, params)
            .map_err(|_| Error::Invalid)?;
    let mut key = Zeroizing::new([0; 32]);
    argon
        .hash_password_into_with_memory(
            password.as_bytes(),
            salt,
            key.as_mut(),
            memory.as_mut_slice(),
        )
        .map_err(|_| Error::Unlock)?;
    Ok(key)
}

impl VaultRoot {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random()))
    }

    /// Signs a device admission record: a device grant or the account's device
    /// list (docs/design/devices/BRIEF.md). Only payloads in those two domains
    /// are signed here, so this path never signs sync protocol bytes.
    pub fn sign_device_record(&self, payload: &[u8]) -> Result<String> {
        const DOMAINS: [&[u8]; 2] = [
            b"[\"misty.device.grant.v2\",",
            b"[\"misty.device.list.v1\",",
        ];
        if payload.len() > 65536 || !DOMAINS.iter().any(|domain| payload.starts_with(domain)) {
            return Err(Error::Invalid);
        }
        Ok(STANDARD.encode(self.signing_key()?.sign(payload).to_bytes()))
    }

    /// Verifies a device admission record against this vault's root key.
    pub fn verify_device_record(public_key: &str, payload: &[u8], signature: &str) -> Result<()> {
        let key = VerifyingKey::from_bytes(&decode_fixed::<32>(public_key)?)
            .map_err(|_| Error::Identity)?;
        let signature = Signature::from_bytes(&decode_fixed::<64>(signature)?);
        key.verify_strict(payload, &signature)
            .map_err(|_| Error::Identity)
    }

    /// A second handle to the same root, kept only while the vault is open so
    /// this device can admit or remove devices.
    pub fn duplicate(&self) -> Self {
        Self(Zeroizing::new(*self.0))
    }

    /// The root's bytes, sealed by the caller to a newly approved device whose
    /// key the person confirmed with a matching code.
    pub fn transfer_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(*self.0)
    }

    /// Accepts a root received from an approving device, only if it matches the
    /// vault's root public key.
    pub fn from_transfer(bytes: &[u8], expected_public_key: &str) -> Result<Self> {
        let root = Self::from_protected(bytes)?;
        if root.public_key()? != expected_public_key {
            return Err(Error::Identity);
        }
        Ok(root)
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

    /// The key that seals cloud clipboard clips for this vault's devices
    /// (docs/design/clipboard/BRIEF.md). Every admitted device derives the same key.
    pub fn clipboard_key(&self, scope: &VaultScope) -> Result<ClipboardKey> {
        scope.validate()?;
        let key = self.derive(
            "misty.clipboard.key.v1",
            &(&scope.deployment, &scope.account_id, &scope.vault_id),
        )?;
        Ok(ClipboardKey(key))
    }

    fn signing_key(&self) -> Result<SigningKey> {
        let seed = self.derive("misty.sync.root-signing.v1", &1)?;
        Ok(SigningKey::from_bytes(&seed))
    }

    pub fn public_key(&self) -> Result<String> {
        Ok(STANDARD.encode(self.signing_key()?.verifying_key().as_bytes()))
    }

    pub fn wrap(&self, scope: &VaultScope, password: &str, secret: &str) -> Result<KeyEnvelope> {
        let salt = random::<16>();
        let key = wrapping_key(password, secret, &salt)?;
        let aad = scope.aad("misty.sync.root-wrapper.v1", &(1, KDF))?;
        let envelope = encrypt(key.as_ref(), self.0.as_ref(), &aad, 4096)?;
        Ok(KeyEnvelope {
            version: 1,
            kdf: KDF.into(),
            salt: STANDARD.encode(salt),
            nonce: envelope.nonce,
            ciphertext: envelope.ciphertext,
        })
    }
}

/// Seals clips in the shared clipboard's ring. A sealed clip is a 12-byte
/// nonce followed by the AES-256-GCM ciphertext. The associated data binds it
/// to its ring slot, so a clip cannot be moved to another slot; the key binds
/// it to the deployment, account and vault.
pub struct ClipboardKey(Zeroizing<[u8; 32]>);

#[cfg(test)]
mod clipboard_key_tests;
