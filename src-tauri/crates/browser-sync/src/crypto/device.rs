//! The device's own signing key.
use super::*;

impl DeviceKey {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random()))
    }

    pub fn public_key(&self) -> String {
        STANDARD.encode(SigningKey::from_bytes(&self.0).verifying_key().as_bytes())
    }

    pub(crate) fn sign(&self, data: &[u8]) -> String {
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
            &scope.vault_id,
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
