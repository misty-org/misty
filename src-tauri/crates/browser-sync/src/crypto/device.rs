//! A session's own signing key.
use super::*;

impl DeviceKey {
    pub fn generate() -> Self {
        Self(Zeroizing::new(random()))
    }

    pub fn public_key(&self) -> String {
        STANDARD.encode(SigningKey::from_bytes(&self.0).verifying_key().as_bytes())
    }

    pub(crate) fn public_key_bytes(&self) -> Vec<u8> {
        SigningKey::from_bytes(&self.0)
            .verifying_key()
            .as_bytes()
            .to_vec()
    }

    pub(crate) fn sign_bytes(&self, data: &[u8]) -> String {
        STANDARD.encode(SigningKey::from_bytes(&self.0).sign(data).to_bytes())
    }

    /// The key's bytes, for keeping it sealed on this computer.
    pub fn secret_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(*self.0)
    }

    pub fn from_secret_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != 32 {
            return Err(Error::Invalid);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }
}
