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

/// Canonical deployment and account identity come from authenticated native
/// configuration, never a remotely supplied event or embedded webpage.
#[derive(Clone)]
pub struct VaultScope {
    pub deployment: String,
    pub account_id: String,
    pub workspace_id: String,
}

impl VaultScope {
    pub fn validate(&self) -> Result<()> {
        if self.deployment.is_empty()
            || self.deployment.len() > 2048
            || self.account_id.is_empty()
            || self.account_id.len() > 1024
            || !valid_id(&self.workspace_id)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }

    fn aad(&self, domain: &str, identity: &impl serde::Serialize) -> Result<Vec<u8>> {
        self.validate()?;
        Ok(serde_json::to_vec(&(
            domain,
            &self.deployment,
            &self.account_id,
            &self.workspace_id,
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

    fn derive(
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

    pub fn unlock(
        scope: &VaultScope,
        envelope: &KeyEnvelope,
        password: &str,
        secret: &str,
        expected_public_key: &str,
    ) -> Result<Self> {
        if envelope.version != 1 || envelope.kdf != KDF {
            return Err(Error::Invalid);
        }
        let salt = decode_fixed(&envelope.salt)?;
        let envelope = Envelope {
            version: envelope.version,
            nonce: envelope.nonce.clone(),
            ciphertext: envelope.ciphertext.clone(),
        };
        envelope.decode(4096)?;
        let aad = scope.aad("misty.sync.root-wrapper.v1", &(1, KDF))?;
        let key = wrapping_key(password, secret, &salt)?;
        let plaintext = decrypt(key.as_ref(), &envelope, &aad, 4096)?;
        let mut root = Zeroizing::new([0; 32]);
        if plaintext.len() != root.len() {
            return Err(Error::Invalid);
        }
        root.copy_from_slice(&plaintext);
        let root = Self(root);
        if root.public_key()? != expected_public_key {
            return Err(Error::Identity);
        }
        Ok(root)
    }

    pub fn grant(
        &self,
        scope: &VaultScope,
        device_id: &str,
        epoch: u64,
        device: &DeviceKey,
    ) -> Result<DeviceGrant> {
        scope.validate()?;
        let mut grant = DeviceGrant {
            workspace_id: scope.workspace_id.clone(),
            device_id: device_id.into(),
            key_epoch: epoch,
            public_key: device.public_key(),
            signature: String::new(),
        };
        grant.signature =
            STANDARD.encode(self.signing_key()?.sign(&grant.signing_bytes()?).to_bytes());
        Ok(grant)
    }

    pub fn verify_grant(&self, scope: &VaultScope, grant: &DeviceGrant) -> Result<()> {
        scope.validate()?;
        if grant.workspace_id != scope.workspace_id {
            return Err(Error::Identity);
        }
        let signature = Signature::from_bytes(&decode_fixed(&grant.signature)?);
        self.signing_key()?
            .verifying_key()
            .verify_strict(&grant.signing_bytes()?, &signature)
            .map_err(|_| Error::Identity)
    }

    fn mutation_aad(scope: &VaultScope, mutation: &Mutation) -> Result<Vec<u8>> {
        scope.aad(
            "misty.sync.payload.v1",
            &(
                &mutation.operation_id,
                &mutation.device_id,
                mutation.device_counter,
                mutation.key_epoch,
            ),
        )
    }

    pub fn seal_mutation(
        &self,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
        operation_id: &str,
        device_counter: u64,
        plaintext: &[u8],
    ) -> Result<Mutation> {
        self.verify_grant(scope, grant)?;
        if grant.public_key != device.public_key()
            || !valid_id(operation_id)
            || !counter(device_counter)
        {
            return Err(Error::Identity);
        }
        let mut mutation = Mutation {
            workspace_id: scope.workspace_id.clone(),
            operation_id: operation_id.into(),
            device_id: grant.device_id.clone(),
            device_counter,
            key_epoch: grant.key_epoch,
            envelope: Envelope {
                version: 1,
                nonce: String::new(),
                ciphertext: String::new(),
            },
            signature: String::new(),
        };
        let key = self.derive(
            "misty.sync.event-key.v1",
            &(&scope.workspace_id, grant.key_epoch),
        )?;
        mutation.envelope = encrypt(
            key.as_ref(),
            plaintext,
            &Self::mutation_aad(scope, &mutation)?,
            MAX_EVENT_BYTES,
        )?;
        mutation.signature = device.sign(&mutation.signing_bytes()?);
        Ok(mutation)
    }

    /// A revoked device's historical signed events may still be replayed. Live
    /// authorization belongs to the server; grant authenticity is verified here.
    pub fn open_mutation(
        &self,
        scope: &VaultScope,
        grant: &DeviceGrant,
        mutation: &Mutation,
    ) -> Result<Zeroizing<Vec<u8>>> {
        self.verify_grant(scope, grant)?;
        if mutation.workspace_id != scope.workspace_id
            || mutation.device_id != grant.device_id
            || mutation.key_epoch != grant.key_epoch
        {
            return Err(Error::Identity);
        }
        let public = VerifyingKey::from_bytes(&decode_fixed(&grant.public_key)?)
            .map_err(|_| Error::Identity)?;
        let signature = Signature::from_bytes(&decode_fixed(&mutation.signature)?);
        public
            .verify_strict(&mutation.signing_bytes()?, &signature)
            .map_err(|_| Error::Identity)?;
        let key = self.derive(
            "misty.sync.event-key.v1",
            &(&scope.workspace_id, mutation.key_epoch),
        )?;
        decrypt(
            key.as_ref(),
            &mutation.envelope,
            &Self::mutation_aad(scope, mutation)?,
            MAX_EVENT_BYTES,
        )
    }

    pub(crate) fn seal_local(
        &self,
        scope: &VaultScope,
        device_id: &str,
        record: &str,
        plaintext: &[u8],
    ) -> Result<Envelope> {
        if !valid_id(device_id) {
            return Err(Error::Invalid);
        }
        let key = self.derive("misty.sync.local-key.v1", &(device_id, &scope.workspace_id))?;
        encrypt(
            key.as_ref(),
            plaintext,
            &scope.aad("misty.sync.local-record.v1", &(device_id, record))?,
            MAX_LOCAL_BYTES,
        )
    }

    pub(crate) fn open_local(
        &self,
        scope: &VaultScope,
        device_id: &str,
        record: &str,
        envelope: &Envelope,
    ) -> Result<Zeroizing<Vec<u8>>> {
        if !valid_id(device_id) {
            return Err(Error::Invalid);
        }
        let key = self.derive("misty.sync.local-key.v1", &(device_id, &scope.workspace_id))?;
        decrypt(
            key.as_ref(),
            envelope,
            &scope.aad("misty.sync.local-record.v1", &(device_id, record))?,
            MAX_LOCAL_BYTES,
        )
    }
}

impl DeviceKey {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random()))
    }

    pub fn public_key(&self) -> String {
        STANDARD.encode(SigningKey::from_bytes(&self.0).verifying_key().as_bytes())
    }

    fn sign(&self, data: &[u8]) -> String {
        STANDARD.encode(SigningKey::from_bytes(&self.0).sign(data).to_bytes())
    }

    pub fn connection_proof(
        &self,
        scope: &VaultScope,
        device_id: &str,
        challenge: &str,
    ) -> Result<String> {
        scope.validate()?;
        if !valid_id(device_id)
            || !(32..=128).contains(&challenge.len())
            || !challenge
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(Error::Invalid);
        }
        Ok(self.sign(&serde_json::to_vec(&(
            "misty.sync.connect.v1",
            &scope.workspace_id,
            device_id,
            challenge,
        ))?))
    }

    pub fn protect(
        &self,
        root: &VaultRoot,
        scope: &VaultScope,
        device_id: &str,
    ) -> Result<Envelope> {
        root.seal_local(scope, device_id, "device-key", self.0.as_ref())
    }

    pub fn restore(
        root: &VaultRoot,
        scope: &VaultScope,
        device_id: &str,
        envelope: &Envelope,
    ) -> Result<Self> {
        let bytes = root.open_local(scope, device_id, "device-key", envelope)?;
        let mut key = Zeroizing::new([0; 32]);
        if bytes.len() != key.len() {
            return Err(Error::Invalid);
        }
        key.copy_from_slice(&bytes);
        Ok(Self(key))
    }
}
