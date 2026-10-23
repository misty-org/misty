//! Unwrapping the vault root with the account password, and sealing Space
//! roots to the personal root.
use super::*;

impl VaultRoot {
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
        let key = legacy_wrapping_key(password, secret, &salt)?;
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

    /// Seals the root under the person's account keys. This is the only wrapper
    /// new vaults get.
    pub fn wrap_account(&self, scope: &VaultScope, keys: &AccountKeys) -> Result<KeyEnvelope> {
        let salt = random::<16>();
        let key = keys.wrapping_key(&salt)?;
        let aad = scope.aad("misty.sync.root-wrapper.v2", &(1, KDF_ACCOUNT))?;
        let envelope = encrypt(key.as_ref(), self.0.as_ref(), &aad, 4096)?;
        Ok(KeyEnvelope {
            version: 1,
            kdf: KDF_ACCOUNT.into(),
            salt: STANDARD.encode(salt),
            nonce: envelope.nonce,
            ciphertext: envelope.ciphertext,
        })
    }

    pub fn unlock_account(
        scope: &VaultScope,
        envelope: &KeyEnvelope,
        keys: &AccountKeys,
        expected_public_key: &str,
    ) -> Result<Self> {
        if envelope.version != 1 || !envelope.is_account() {
            return Err(Error::Invalid);
        }
        let salt = decode_fixed(&envelope.salt)?;
        let sealed = Envelope {
            version: envelope.version,
            nonce: envelope.nonce.clone(),
            ciphertext: envelope.ciphertext.clone(),
        };
        sealed.decode(4096)?;
        let aad = scope.aad("misty.sync.root-wrapper.v2", &(1, KDF_ACCOUNT))?;
        let key = keys.wrapping_key(&salt)?;
        let plaintext = decrypt(key.as_ref(), &sealed, &aad, 4096)?;
        let root = Self::from_protected(&plaintext)?;
        if root.public_key()? != expected_public_key {
            return Err(Error::Identity);
        }
        Ok(root)
    }

    /// Authorizes `envelope` as this vault's wrapper at `generation`. Only a
    /// holder of the unlocked root can sign one.
    pub fn sign_key_transition(
        &self,
        scope: &VaultScope,
        generation: u64,
        envelope: &KeyEnvelope,
    ) -> Result<KeyTransition> {
        scope.validate()?;
        let bytes = KeyTransition::signing_bytes(&scope.vault_id, generation, envelope)?;
        Ok(KeyTransition {
            generation,
            signature: STANDARD.encode(self.signing_key()?.sign(&bytes).to_bytes()),
        })
    }

    /// Seals another Space vault's root to this personal root, as that vault's
    /// `space_key_envelope`, so the one sync password opens every vault. The
    /// key derives from this root and the personal vault's identity; the Space
    /// vault's identity is the associated data, so an envelope opens only for
    /// the vault it was sealed for.
    pub fn seal_space_root(
        &self,
        personal: &VaultScope,
        space: &VaultScope,
        space_root: &VaultRoot,
    ) -> Result<Envelope> {
        let (key, aad) = self.space_seal(personal, space)?;
        encrypt(key.as_ref(), space_root.0.as_ref(), &aad, 4096)
    }

    /// Opens a Space vault's root with this personal root, only if it matches
    /// that vault's root public key.
    pub fn open_space_root(
        &self,
        personal: &VaultScope,
        space: &VaultScope,
        envelope: &Envelope,
        expected_public_key: &str,
    ) -> Result<Self> {
        let (key, aad) = self.space_seal(personal, space)?;
        let plaintext = decrypt(key.as_ref(), envelope, &aad, 4096)?;
        let root = Self::from_protected(&plaintext)?;
        if root.public_key()? != expected_public_key {
            return Err(Error::Identity);
        }
        Ok(root)
    }

    fn space_seal(
        &self,
        personal: &VaultScope,
        space: &VaultScope,
    ) -> Result<(Zeroizing<[u8; 32]>, Vec<u8>)> {
        personal.validate()?;
        if personal.deployment != space.deployment
            || personal.account_id != space.account_id
            || personal.vault_id == space.vault_id
        {
            return Err(Error::Invalid);
        }
        let key = self.derive(
            "misty.sync.space-root-seal.v1",
            &(
                &personal.deployment,
                &personal.account_id,
                &personal.vault_id,
            ),
        )?;
        let aad = space.aad("misty.sync.space-root.v1", &personal.vault_id)?;
        Ok((key, aad))
    }
}
