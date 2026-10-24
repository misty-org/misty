//! Sealing clips for the shared clipboard's ring.
use super::*;

/// The largest sealed clip: the ring's record limit.
pub const MAX_SEALED_CLIP_BYTES: usize = crate::collections::CLIPBOARD_MAX_BYTES;
const SEAL_OVERHEAD: usize = 12 + 16;

impl ClipboardKey {
    fn aad(slot: u8) -> Result<Vec<u8>> {
        if slot >= crate::collections::CLIPBOARD_SLOTS {
            return Err(Error::Invalid);
        }
        Ok(serde_json::to_vec(&("misty.clipboard.slot.v1", slot))?)
    }

    /// The most plaintext a sealed clip can hold.
    pub const fn capacity() -> usize {
        MAX_SEALED_CLIP_BYTES - SEAL_OVERHEAD
    }

    pub fn seal(&self, slot: u8, plaintext: &[u8]) -> Result<Vec<u8>> {
        if plaintext.len() > Self::capacity() {
            return Err(Error::TooLarge);
        }
        let nonce = random::<12>();
        let aad = Self::aad(slot)?;
        let ciphertext = cipher(self.0.as_ref())?
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| Error::Unlock)?;
        let mut sealed = Vec::with_capacity(12 + ciphertext.len());
        sealed.extend_from_slice(&nonce);
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    pub fn open(&self, slot: u8, sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        if sealed.len() < SEAL_OVERHEAD || sealed.len() > MAX_SEALED_CLIP_BYTES {
            return Err(Error::Invalid);
        }
        let aad = Self::aad(slot)?;
        let (nonce, ciphertext) = sealed.split_at(12);
        cipher(self.0.as_ref())?
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &aad,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| Error::Unlock)
    }
}
