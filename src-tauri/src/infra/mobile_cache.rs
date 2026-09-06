use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

const KEY_SERVICE: &str = "misty.mobile-cache";
const KEY_ACCOUNT: &str = "install-v1";
const MAX_RECORD_BYTES: usize = 2 * 1024 * 1024;
const ACCOUNT_SOFT_CAP_BYTES: u64 = 32 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedRecord {
    version: u8,
    nonce: String,
    ciphertext: String,
}

pub fn read(cache_root: &Path, account_id: &str, record_key: &str) -> ApiResult<Option<String>> {
    let path = record_path(cache_root, account_id, record_key)?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(cache_error("read", error)),
    };
    if bytes.len() > MAX_RECORD_BYTES * 2 {
        return Err(ApiError::Message(
            "Mobile cache record is too large.".to_owned(),
        ));
    }
    let record: EncryptedRecord = serde_json::from_slice(&bytes)?;
    let plaintext = decrypt(&install_key()?, account_id, record_key, &record)?;
    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|_| ApiError::Message("Mobile cache record is invalid.".to_owned()))
}

pub fn write(cache_root: &Path, account_id: &str, record_key: &str, value: &str) -> ApiResult<()> {
    if value.len() > MAX_RECORD_BYTES {
        return Err(ApiError::Message(
            "Mobile cache record is too large.".to_owned(),
        ));
    }
    let path = record_path(cache_root, account_id, record_key)?;
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::Message("Mobile cache path is invalid.".to_owned()))?;
    fs::create_dir_all(parent).map_err(|error| cache_error("prepare", error))?;
    let record = encrypt(&install_key()?, account_id, record_key, value.as_bytes())?;
    let bytes = serde_json::to_vec(&record)?;
    let temporary = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, bytes).map_err(|error| cache_error("write", error))?;
    set_private_file_permissions(&temporary)?;
    fs::rename(&temporary, &path).map_err(|error| cache_error("activate", error))?;
    set_private_file_permissions(&path)?;
    cleanup_account(parent)?;
    Ok(())
}

pub fn remove(cache_root: &Path, account_id: &str, record_key: &str) -> ApiResult<()> {
    let path = record_path(cache_root, account_id, record_key)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cache_error("remove", error)),
    }
}

pub fn purge_account(cache_root: &Path, account_id: &str) -> ApiResult<()> {
    let account_path = account_path(cache_root, account_id)?;
    match fs::remove_dir_all(account_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cache_error("purge", error)),
    }
}

pub fn purge_all(cache_root: &Path) -> ApiResult<()> {
    let path = cache_root.join("mobile").join("v1");
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cache_error("purge", error)),
    }
}

fn install_key() -> ApiResult<[u8; 32]> {
    if let Some(encoded) = credential_store::load(KEY_SERVICE, KEY_ACCOUNT)
        .map_err(|error| ApiError::Message(format!("Could not read mobile cache key: {error}")))?
    {
        let decoded = STANDARD_NO_PAD
            .decode(encoded)
            .map_err(|_| ApiError::Message("Mobile cache key is invalid.".to_owned()))?;
        return decoded
            .try_into()
            .map_err(|_| ApiError::Message("Mobile cache key is invalid.".to_owned()));
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    credential_store::store(KEY_SERVICE, KEY_ACCOUNT, &STANDARD_NO_PAD.encode(key))
        .map_err(|error| ApiError::Message(format!("Could not store mobile cache key: {error}")))?;
    Ok(key)
}

fn encrypt(
    key: &[u8; 32],
    account: &str,
    record_key: &str,
    value: &[u8],
) -> ApiResult<EncryptedRecord> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| ApiError::Message("Mobile cache encryption is unavailable.".to_owned()))?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: value,
                aad: associated_data(account, record_key).as_bytes(),
            },
        )
        .map_err(|_| ApiError::Message("Could not encrypt mobile cache record.".to_owned()))?;
    Ok(EncryptedRecord {
        version: 1,
        nonce: STANDARD_NO_PAD.encode(nonce),
        ciphertext: STANDARD_NO_PAD.encode(ciphertext),
    })
}

fn decrypt(
    key: &[u8; 32],
    account: &str,
    record_key: &str,
    record: &EncryptedRecord,
) -> ApiResult<Vec<u8>> {
    if record.version != 1 {
        return Err(ApiError::Message(
            "Mobile cache version is not supported.".to_owned(),
        ));
    }
    let nonce = STANDARD_NO_PAD
        .decode(&record.nonce)
        .map_err(|_| ApiError::Message("Mobile cache nonce is invalid.".to_owned()))?;
    let nonce: [u8; 12] = nonce
        .try_into()
        .map_err(|_| ApiError::Message("Mobile cache nonce is invalid.".to_owned()))?;
    let ciphertext = STANDARD_NO_PAD
        .decode(&record.ciphertext)
        .map_err(|_| ApiError::Message("Mobile cache record is invalid.".to_owned()))?;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| ApiError::Message("Mobile cache decryption is unavailable.".to_owned()))?;
    cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: associated_data(account, record_key).as_bytes(),
            },
        )
        .map_err(|_| ApiError::Message("Mobile cache record could not be decrypted.".to_owned()))
}

fn record_path(cache_root: &Path, account_id: &str, record_key: &str) -> ApiResult<PathBuf> {
    if record_key.trim().is_empty() || record_key.len() > 512 {
        return Err(ApiError::Message(
            "Mobile cache record key is invalid.".to_owned(),
        ));
    }
    Ok(account_path(cache_root, account_id)?.join(format!("{}.bin", digest(record_key))))
}

fn account_path(cache_root: &Path, account_id: &str) -> ApiResult<PathBuf> {
    if account_id.trim().is_empty() || account_id.len() > 512 {
        return Err(ApiError::Message(
            "Mobile cache account is invalid.".to_owned(),
        ));
    }
    Ok(cache_root
        .join("mobile")
        .join("v1")
        .join(digest(account_id)))
}

fn associated_data(account_id: &str, record_key: &str) -> String {
    format!("misty-mobile-cache-v1\0{account_id}\0{record_key}")
}

fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn cleanup_account(path: &Path) -> ApiResult<()> {
    let now = SystemTime::now();
    let mut files = fs::read_dir(path)
        .map_err(|error| cache_error("inspect", error))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            metadata
                .is_file()
                .then_some((entry.path(), metadata.modified().ok()?, metadata.len()))
        })
        .collect::<Vec<_>>();
    for (file, modified, _) in &files {
        if now.duration_since(*modified).unwrap_or_default() > RETENTION {
            let _ = fs::remove_file(file);
        }
    }
    files.retain(|(file, _, _)| file.exists());
    files.sort_by_key(|(_, modified, _)| *modified);
    let mut total: u64 = files.iter().map(|(_, _, size)| size).sum();
    for (file, _, size) in files {
        if total <= ACCOUNT_SOFT_CAP_BYTES {
            break;
        }
        if fs::remove_file(file).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

fn cache_error(action: &str, error: std::io::Error) -> ApiError {
    ApiError::Message(format!("Could not {action} mobile cache: {error}"))
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> ApiResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| cache_error("secure", error))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> ApiResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encryption_is_account_and_record_bound() {
        let key = [7u8; 32];
        let encrypted = encrypt(&key, "account-a", "draft", b"hello").unwrap();
        assert_eq!(
            decrypt(&key, "account-a", "draft", &encrypted).unwrap(),
            b"hello"
        );
        assert!(decrypt(&key, "account-b", "draft", &encrypted).is_err());
        assert!(decrypt(&key, "account-a", "other", &encrypted).is_err());
    }
}
