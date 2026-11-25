use std::path::PathBuf;

use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const MAX_SCRIPT_BYTES: u64 = 256 << 10;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RegistryFile {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

const BLOBS: &str = "https://registry.mistysys.com/blobs/";

fn cache_dir() -> Result<PathBuf, String> {
    file_access::paths::misty_home_dir()
        .map(|home| home.join("registry-files"))
        .ok_or_else(|| "Misty has no data folder to keep the registry's files in.".to_owned())
}

fn checked(file: &RegistryFile, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() as u64 != file.size || hex::encode(Sha256::digest(&bytes)) != file.sha256 {
        return Err("A file from the registry doesn't match its checksum.".into());
    }
    String::from_utf8(bytes).map_err(|_| "A script from the registry isn't text.".to_owned())
}

pub async fn script(file: &RegistryFile) -> Result<String, String> {
    let named = file.sha256.len() == 64 && file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !named || file.size > MAX_SCRIPT_BYTES {
        return Err("The registry names a script Misty won't take.".into());
    }
    let cached = cache_dir()?.join(format!("{}.js", file.sha256));
    if let Ok(bytes) = file_access::fs::read(&cached) {
        if let Ok(text) = checked(file, bytes) {
            return Ok(text);
        }
    }
    let bytes = crate::apps::commands::download(&file.url, MAX_SCRIPT_BYTES).await?;
    let text = checked(file, bytes)?;
    if let Some(folder) = cached.parent() {
        if file_access::fs::create_dir_all(folder).is_ok() {
            let _ = file_access::fs::write(&cached, text.as_bytes());
        }
    }
    Ok(text)
}

fn named(file: &RegistryFile) -> bool {
    file.sha256.len() == 64 && file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn matches_blob(file: &RegistryFile, bytes: &[u8]) -> bool {
    bytes.len() as u64 == file.size && hex::encode(Sha256::digest(bytes)) == file.sha256
}

pub async fn blob(file: &RegistryFile, max: u64) -> Result<Vec<u8>, String> {
    if !named(file) || file.size > max || file.url != format!("{BLOBS}{}", file.sha256) {
        return Err("The registry names a file Misty won't take.".into());
    }
    let cached = cache_dir()?.join(&file.sha256);
    if let Ok(bytes) = file_access::fs::read(&cached) {
        if matches_blob(file, &bytes) {
            return Ok(bytes);
        }
    }
    let bytes = crate::apps::commands::download(&file.url, max).await?;
    if !matches_blob(file, &bytes) {
        return Err("A file from the registry doesn't match its checksum.".into());
    }
    if let Some(folder) = cached.parent() {
        if file_access::fs::create_dir_all(folder).is_ok() {
            let _ = file_access::fs::write(&cached, &bytes);
        }
    }
    Ok(bytes)
}
