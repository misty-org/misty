//! The vault's keys: the password that seals its root, the opaque names the server sees, and the
//! sealing of each record. Nothing here does any I/O.
//!
//! The password is stretched on the client with a random per-vault salt, and only ever opens the
//! sealed root. The server holds the sealed root and the root's public key, so it can't read
//! anything and can't tell whether a password is right. No server address is bound in here: a
//! vault keeps working if its server moves.
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use hkdf::hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use super::codec;
use crate::{crypto::VaultRoot, Error, Result};

const NONCE: usize = 12;
/// What new vaults use. The label travels with the sealed root, so this can rise later.
const KDF_MEMORY_KIB: u32 = 131_072;
const KDF_TIME: u32 = 3;
const KDF_LANES: u32 = 1;
/// Parameters a sealed root may ask for. A hostile server can't make a client do almost no work
/// and call that a password check, nor make it allocate without limit.
const KDF_MEMORY_RANGE: std::ops::RangeInclusive<u32> = 65_536..=1_048_576;
const KDF_TIME_RANGE: std::ops::RangeInclusive<u32> = 2..=10;
const KDF_LANES_RANGE: std::ops::RangeInclusive<u32> = 1..=8;

/// The vault root sealed under the vault password.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyEnvelope {
    pub version: u8,
    pub kdf: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

impl KeyEnvelope {
    /// What a key transition signs: a digest of every wrapper field, so a transition covers
    /// exactly one wrapper. Must match the server's `SyncKeyEnvelope.digest`.
    pub fn digest(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(b"misty.sync.key-envelope.v1");
        for part in [
            self.version.to_string().as_str(),
            &self.kdf,
            &self.salt,
            &self.nonce,
            &self.ciphertext,
        ] {
            hash.update(b"\n");
            hash.update(part.as_bytes());
        }
        hash.finalize().into()
    }

    fn params(&self) -> Result<Params> {
        let rest = self
            .kdf
            .strip_prefix("argon2id-m")
            .and_then(|rest| rest.strip_suffix(".vault-v1"))
            .ok_or(Error::Invalid)?;
        let mut parts = rest.split('-');
        let mut next = |tag: char| -> Result<u32> {
            parts
                .next()
                .map(|part| part.trim_start_matches(tag))
                .and_then(|value| value.parse().ok())
                .ok_or(Error::Invalid)
        };
        let (memory, time, lanes) = (next('m')?, next('t')?, next('p')?);
        if !KDF_MEMORY_RANGE.contains(&memory)
            || !KDF_TIME_RANGE.contains(&time)
            || !KDF_LANES_RANGE.contains(&lanes)
        {
            return Err(Error::Invalid);
        }
        Params::new(memory, time, lanes, Some(32)).map_err(|_| Error::Invalid)
    }
}

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn stretch(password: &str, salt: &[u8], params: Params) -> Result<Zeroizing<[u8; 32]>> {
    let password = Zeroizing::new(password.nfkc().collect::<String>());
    if password.is_empty() || password.len() > crate::password::MAX_BYTES {
        return Err(Error::Invalid);
    }
    let mut memory = Zeroizing::new(vec![argon2::Block::default(); params.block_count()]);
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into_with_memory(
            password.as_bytes(),
            salt,
            key.as_mut(),
            memory.as_mut_slice(),
        )
        .map_err(|_| Error::Unlock)?;
    Ok(key)
}

fn root_aad(vault_id: &str, kdf: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&("misty.vault.root.v1", vault_id, kdf))?)
}

/// Seals the root under a password, with a fresh salt. Slow on purpose: call it off the UI path.
pub fn seal_root(root: &VaultRoot, vault_id: &str, password: &str) -> Result<KeyEnvelope> {
    let kdf = format!("argon2id-m{KDF_MEMORY_KIB}-t{KDF_TIME}-p{KDF_LANES}.vault-v1");
    let salt = random::<32>();
    let params =
        Params::new(KDF_MEMORY_KIB, KDF_TIME, KDF_LANES, Some(32)).map_err(|_| Error::Invalid)?;
    let key = stretch(password, &salt, params)?;
    let nonce = random::<NONCE>();
    let aad = root_aad(vault_id, &kdf)?;
    let ciphertext = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| Error::Invalid)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: root.protected_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| Error::Unlock)?;
    Ok(KeyEnvelope {
        version: 1,
        kdf,
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

/// Opens the sealed root with a password, and checks it is the root the vault names. A wrong
/// password is `Error::Unlock`.
pub fn open_root(
    envelope: &KeyEnvelope,
    vault_id: &str,
    password: &str,
    expected_public_key: &[u8],
) -> Result<VaultRoot> {
    if envelope.version != 1 {
        return Err(Error::Invalid);
    }
    let decode = |value: &str| STANDARD.decode(value).map_err(|_| Error::Invalid);
    let (salt, nonce, ciphertext) = (
        decode(&envelope.salt)?,
        decode(&envelope.nonce)?,
        decode(&envelope.ciphertext)?,
    );
    if nonce.len() != NONCE || !(16..=64).contains(&salt.len()) {
        return Err(Error::Invalid);
    }
    let key = stretch(password, &salt, envelope.params()?)?;
    let aad = root_aad(vault_id, &envelope.kdf)?;
    let bytes = Zeroizing::new(
        Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| Error::Invalid)?
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| Error::Unlock)?,
    );
    let root = VaultRoot::from_protected(&bytes)?;
    if public_key(&root)? != expected_public_key {
        return Err(Error::Identity);
    }
    Ok(root)
}

pub fn public_key(root: &VaultRoot) -> Result<Vec<u8>> {
    STANDARD
        .decode(root.public_key()?)
        .map_err(|_| Error::Invalid)
}

fn verify(public: &[u8], payload: &[u8], signature: &[u8]) -> Result<()> {
    let public: [u8; 32] = public.try_into().map_err(|_| Error::Identity)?;
    let signature: [u8; 64] = signature.try_into().map_err(|_| Error::Identity)?;
    VerifyingKey::from_bytes(&public)
        .map_err(|_| Error::Identity)?
        .verify_strict(payload, &Signature::from_bytes(&signature))
        .map_err(|_| Error::Identity)
}

/// What a change of the sealed root signs. Must match the server's `keyTransitionSigningBytes`.
fn transition_bytes(vault_id: &str, generation: u64, envelope: &KeyEnvelope) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "misty.sync.key-transition.v1",
        vault_id,
        generation,
        STANDARD.encode(envelope.digest()),
    ))?)
}

/// Signs a change of password, for the next generation.
pub fn sign_transition(
    root: &VaultRoot,
    vault_id: &str,
    generation: u64,
    envelope: &KeyEnvelope,
) -> Result<Vec<u8>> {
    root.sign_domain(&transition_bytes(vault_id, generation, envelope)?)
}

/// Checks a sealed root the server hands out against the root key this client pinned, so a server
/// can't swap in a wrapper of its own.
pub fn verify_transition(
    public: &[u8],
    vault_id: &str,
    generation: u64,
    envelope: &KeyEnvelope,
    signature: &[u8],
) -> Result<()> {
    verify(
        public,
        &transition_bytes(vault_id, generation, envelope)?,
        signature,
    )
}

/// What a session's admission signs. Must match the server's `SyncSessionGrant.SigningBytes`.
pub fn grant_bytes(vault_id: &str, session_id: &str, public_key: &[u8]) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "misty.sync.session.v1",
        vault_id,
        session_id,
        STANDARD.encode(public_key),
    ))?)
}

/// What removing a session signs. Must match the server's `removalBytes`.
pub fn removal_bytes(vault_id: &str, session_id: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "misty.sync.session-remove.v1",
        vault_id,
        session_id,
    ))?)
}

/// What destroying the vault signs. Must match the server's `destroyBytes`.
pub fn destroy_bytes(vault_id: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&("misty.sync.destroy.v1", vault_id))?)
}

/// What a session signs to prove it holds its key when it connects.
pub fn connect_bytes(vault_id: &str, session_id: &str, challenge: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "misty.sync.connect.v1",
        vault_id,
        session_id,
        challenge,
    ))?)
}

/// A record opened from the server: what it really is, known only to clients.
#[derive(Debug, PartialEq, Eq)]
pub struct OpenedRecord {
    pub profile: String,
    pub collection: String,
    pub id: String,
    pub edited_at: u64,
    /// The record's body; `None` is a deletion.
    pub body: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize)]
struct Sealed<'a> {
    #[serde(borrow)]
    profile: std::borrow::Cow<'a, str>,
    #[serde(borrow)]
    collection: std::borrow::Cow<'a, str>,
    #[serde(borrow)]
    id: std::borrow::Cow<'a, str>,
    edited_at: u64,
    /// Base64 of the body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

/// Seals and opens records. All keys come from the root by purpose, so one can never stand in for
/// another.
pub struct RecordKeys {
    vault_id: String,
    names: Zeroizing<[u8; 32]>,
    cipher: Aes256Gcm,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

impl RecordKeys {
    pub fn new(root: &VaultRoot, vault_id: &str) -> Result<Self> {
        let names = root.derive("misty.vault.names.v1", &vault_id)?;
        let key = root.derive("misty.vault.records.v1", &vault_id)?;
        Ok(Self {
            vault_id: vault_id.to_owned(),
            names,
            cipher: Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| Error::Invalid)?,
        })
    }

    fn name(&self, domain: &str, parts: &[&str]) -> Result<String> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.names.as_ref())
            .map_err(|_| Error::Invalid)?;
        mac.update(&serde_json::to_vec(&(domain, parts))?);
        Ok(hex(&mac.finalize().into_bytes()))
    }

    /// The opaque name the server knows a profile's collection by.
    pub fn scope(&self, profile: &str, collection: &str) -> Result<String> {
        self.name("scope", &[profile, collection])
    }

    /// The opaque name the server knows a record by.
    pub fn key(&self, profile: &str, collection: &str, id: &str) -> Result<String> {
        self.name("key", &[profile, collection, id])
    }

    fn aad(&self, scope: &str, key: &str, version: u64) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&(
            "misty.vault.record.v1",
            &self.vault_id,
            scope,
            key,
            version,
        ))?)
    }

    /// Seals a record for the version it will have once stored, so the server can't move it to
    /// another name or serve it as a different version. A deletion is sealed too: a server can't
    /// forge one.
    pub fn seal(
        &self,
        profile: &str,
        collection: &str,
        id: &str,
        version: u64,
        edited_at: u64,
        body: Option<&[u8]>,
    ) -> Result<Vec<u8>> {
        let (scope, key) = (
            self.scope(profile, collection)?,
            self.key(profile, collection, id)?,
        );
        let plain = Zeroizing::new(serde_json::to_vec(&Sealed {
            profile: profile.into(),
            collection: collection.into(),
            id: id.into(),
            edited_at,
            body: body.map(|body| STANDARD.encode(body)),
        })?);
        let framed = Zeroizing::new(codec::encode(&plain)?);
        let nonce = random::<NONCE>();
        let aad = self.aad(&scope, &key, version)?;
        let ciphertext = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &framed,
                    aad: &aad,
                },
            )
            .map_err(|_| Error::Unlock)?;
        let mut out = Vec::with_capacity(NONCE + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Opens a record from the server and checks it is what its name says.
    pub fn open(
        &self,
        scope: &str,
        key: &str,
        version: u64,
        sealed: &[u8],
    ) -> Result<OpenedRecord> {
        if sealed.len() < NONCE + 16 {
            return Err(Error::Invalid);
        }
        let aad = self.aad(scope, key, version)?;
        let framed = Zeroizing::new(
            self.cipher
                .decrypt(
                    Nonce::from_slice(&sealed[..NONCE]),
                    Payload {
                        msg: &sealed[NONCE..],
                        aad: &aad,
                    },
                )
                .map_err(|_| Error::Unlock)?,
        );
        let plain = Zeroizing::new(codec::decode(&framed)?);
        let record: Sealed<'_> = serde_json::from_slice(&plain)?;
        if self.scope(&record.profile, &record.collection)? != scope
            || self.key(&record.profile, &record.collection, &record.id)? != key
        {
            return Err(Error::Identity);
        }
        Ok(OpenedRecord {
            profile: record.profile.into_owned(),
            collection: record.collection.into_owned(),
            id: record.id.into_owned(),
            edited_at: record.edited_at,
            body: record
                .body
                .map(|body| STANDARD.decode(body).map_err(|_| Error::Invalid))
                .transpose()?,
        })
    }
}

#[cfg(test)]
mod tests;
