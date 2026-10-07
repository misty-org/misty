//! The key a Chromium browser encrypts cookie values with.
//!
//! - macOS: a password in the browser's own Keychain item ("Chrome Safe
//!   Storage"), stretched with PBKDF2-SHA1, then AES-128-CBC (`v10`). Reading
//!   the item shows the person the system's Keychain prompt for that browser.
//!   Misty's own credentials never use the Keychain; this reads another app's
//!   item only when the person imports its sign-ins.
//! - Windows: an AES-256-GCM key in `Local State`, protected with DPAPI for
//!   this Windows user (`v10`/`v11`). Chrome 127+ also binds new values to its
//!   own executable (`v20`); no other app can read those.
//! - Linux: the fixed `peanuts` password (`v10`) when no keyring is in use.
use super::discover::Browser;
use std::path::Path;
use zeroize::Zeroizing;

pub enum Decrypted {
    Value(Zeroizing<Vec<u8>>),
    /// Encrypted for the browser's executable only (`v20`).
    Locked,
    Failed,
}

pub struct CookieKey {
    cbc: Option<Zeroizing<[u8; 16]>>,
    gcm: Option<Zeroizing<Vec<u8>>>,
}

fn hmac_sha1(key: &[u8], parts: &[&[u8]]) -> [u8; 20] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..20].copy_from_slice(&sha1_smol::Sha1::from(key).digest().bytes());
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = sha1_smol::Sha1::new();
    inner.update(&block.map(|b| b ^ 0x36));
    for part in parts {
        inner.update(part);
    }
    let mut outer = sha1_smol::Sha1::new();
    outer.update(&block.map(|b| b ^ 0x5c));
    outer.update(&inner.digest().bytes());
    outer.digest().bytes()
}

/// PBKDF2-HMAC-SHA1 for keys of at most one SHA-1 block (20 bytes).
pub fn pbkdf2_sha1<const N: usize>(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
) -> Zeroizing<[u8; N]> {
    let mut u = hmac_sha1(password, &[salt, &1u32.to_be_bytes()]);
    let mut t = u;
    for _ in 1..iterations {
        u = hmac_sha1(password, &[&u]);
        for (a, b) in t.iter_mut().zip(u) {
            *a ^= b;
        }
    }
    let mut out = Zeroizing::new([0u8; N]);
    out.copy_from_slice(&t[..N]);
    out
}

fn cbc_decrypt(key: &[u8; 16], data: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    cbc::Decryptor::<aes::Aes128>::new(key.into(), &[b' '; 16].into())
        .decrypt_padded_vec_mut::<Pkcs7>(data)
        .ok()
        .map(Zeroizing::new)
}

fn gcm_decrypt(key: &[u8], data: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
    if data.len() < 12 + 16 {
        return None;
    }
    Aes256Gcm::new_from_slice(key)
        .ok()?
        .decrypt(Nonce::from_slice(&data[..12]), &data[12..])
        .ok()
        .map(Zeroizing::new)
}

impl CookieKey {
    pub fn from_password(password: &[u8], iterations: u32) -> Self {
        Self {
            cbc: Some(pbkdf2_sha1::<16>(password, b"saltysalt", iterations)),
            gcm: None,
        }
    }

    pub fn decrypt(&self, value: &[u8]) -> Decrypted {
        let (prefix, body) = value.split_at(value.len().min(3));
        let result = match prefix {
            b"v20" => return Decrypted::Locked,
            b"v10" | b"v11" => match (&self.gcm, &self.cbc) {
                (Some(key), _) => gcm_decrypt(key, body),
                (None, Some(key)) if prefix == b"v10" => cbc_decrypt(key, body),
                _ => None,
            },
            _ => None,
        };
        result.map(Decrypted::Value).unwrap_or(Decrypted::Failed)
    }
}

#[cfg(target_os = "macos")]
pub fn key(browser: Browser, _profile: &Path) -> Result<CookieKey, String> {
    let (service, account) = browser
        .safe_storage()
        .ok_or_else(|| "That browser's sign-ins can't be imported.".to_owned())?;
    let password = security_framework::passwords::get_generic_password(service, account)
        .map(Zeroizing::new)
        .map_err(|_| {
            format!(
                "Misty wasn't allowed to read {}'s sign-ins. Try again and choose Allow.",
                browser.name()
            )
        })?;
    Ok(CookieKey::from_password(&password, 1003))
}

#[cfg(windows)]
pub fn key(browser: Browser, profile: &Path) -> Result<CookieKey, String> {
    use base64::Engine as _;
    let state = [profile.join("Local State"), profile.join("../Local State")]
        .into_iter()
        .find_map(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .ok_or_else(|| format!("{}'s sign-in key could not be found.", browser.name()))?;
    let protected = state["os_crypt"]["encrypted_key"]
        .as_str()
        .and_then(|value| base64::engine::general_purpose::STANDARD.decode(value).ok())
        .and_then(|bytes| bytes.strip_prefix(b"DPAPI").map(<[u8]>::to_vec))
        .ok_or_else(|| format!("{}'s sign-in key could not be read.", browser.name()))?;
    let key = unprotect(&protected)
        .ok_or_else(|| format!("{}'s sign-in key could not be read.", browser.name()))?;
    Ok(CookieKey {
        cbc: None,
        gcm: Some(key),
    })
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output).ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Some(Zeroizing::new(bytes))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn key(_browser: Browser, _profile: &Path) -> Result<CookieKey, String> {
    Ok(CookieKey::from_password(b"peanuts", 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_keys_with_pbkdf2_sha1() {
        // RFC 6070, test vectors 1 and 2.
        let one = pbkdf2_sha1::<20>(b"password", b"salt", 1);
        assert_eq!(hex(&one[..]), "0c60c80f961f0e71f3a9b524af6012062fe037a6");
        let two = pbkdf2_sha1::<20>(b"password", b"salt", 2);
        assert_eq!(hex(&two[..]), "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957");
    }

    #[test]
    fn decrypts_chromium_cbc_values_and_reports_bound_ones() {
        use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
        let key = CookieKey::from_password(b"peanuts", 1);
        let raw = key.cbc.as_ref().unwrap();
        let sealed = cbc::Encryptor::<aes::Aes128>::new((&**raw).into(), &[b' '; 16].into())
            .encrypt_padded_vec_mut::<Pkcs7>(b"session-value");
        let mut value = b"v10".to_vec();
        value.extend(sealed);
        assert!(matches!(key.decrypt(&value), Decrypted::Value(v) if &v[..] == b"session-value"));
        assert!(matches!(
            key.decrypt(b"v20xxxxxxxxxxxxxxxx"),
            Decrypted::Locked
        ));
        assert!(matches!(key.decrypt(b"v10short"), Decrypted::Failed));
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
