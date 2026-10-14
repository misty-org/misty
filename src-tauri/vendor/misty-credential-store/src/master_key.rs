//! The master key: 32 random bytes that encrypt every secret in `misty.db`.
//! Release builds keep it in the OS keychain (service `com.misty.auth`: macOS Keychain,
//! Windows Credential Manager, Linux Secret Service). Debug builds keep it in a private
//! file next to the database, so a rebuild's new code signature never prompts.
use std::{io, sync::Mutex};
use zeroize::Zeroizing;

pub(crate) const SERVICE: &str = "com.misty.auth";
pub(crate) type Key = Zeroizing<[u8; 32]>;

static CACHED: Mutex<Option<Key>> = Mutex::new(None);

/// The master key, created on first use and held in memory afterward.
pub(crate) fn get() -> io::Result<Key> {
    let mut cached = CACHED
        .lock()
        .map_err(|_| io::Error::other("Master key lock"))?;
    if let Some(key) = cached.as_ref() {
        return Ok(Zeroizing::new(**key));
    }
    let key = load_or_create()?;
    *cached = Some(Zeroizing::new(*key));
    Ok(key)
}

fn random_key() -> io::Result<Key> {
    use chacha20poly1305::aead::{rand_core::RngCore, OsRng};
    let mut bytes = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(bytes.as_mut());
    Ok(bytes)
}

fn decode(bytes: &[u8]) -> io::Result<Key> {
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| io::Error::other("The stored master key is not 32 bytes"))?;
    Ok(Zeroizing::new(array))
}

#[cfg(debug_assertions)]
fn load_or_create() -> io::Result<Key> {
    use std::io::Write;
    let path = super::data_dir()?.join("dev-master.key");
    match std::fs::read_to_string(&path) {
        Ok(text) => return decode(&hex::decode(text.trim()).map_err(io::Error::other)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(error),
    }
    let key = random_key()?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            file.write_all(hex::encode(key.as_ref()).as_bytes())?;
            file.sync_all()?;
            Ok(key)
        }
        // Another process created it first: use theirs.
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            decode(&hex::decode(std::fs::read_to_string(&path)?.trim()).map_err(io::Error::other)?)
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(debug_assertions))]
fn load_or_create() -> io::Result<Key> {
    let profile = super::profile();
    let account = if profile == "default" {
        "master-key".to_owned()
    } else {
        format!("master-key:{profile}")
    };
    let entry = keyring::Entry::new(SERVICE, &account).map_err(keychain_error)?;
    match entry.get_secret() {
        Ok(bytes) => return decode(&bytes),
        Err(keyring::Error::NoEntry) => (),
        Err(error) => return Err(keychain_error(error)),
    }
    let key = random_key()?;
    entry.set_secret(key.as_ref()).map_err(keychain_error)?;
    // Read it back: if another process won the race, use the stored key.
    decode(&entry.get_secret().map_err(keychain_error)?)
}

#[cfg(not(debug_assertions))]
fn keychain_error(error: keyring::Error) -> io::Error {
    io::Error::other(format!(
        "Misty could not use the system keychain (service {SERVICE}): {error}. \
         Unlock or enable it, then restart Misty."
    ))
}

#[cfg(test)]
pub(crate) fn random_for_tests() -> Key {
    random_key().unwrap()
}
