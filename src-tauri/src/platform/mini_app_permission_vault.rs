//! One Keychain unlock per process, shared by every App permission path.
//! Native records are authenticated and encrypted; the renderer never gets the key.
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

const SERVICE: &str = "com.misty.native-app.permissions.v2";
const KEY_ACCOUNT: &str = "installation-encryption-key";
const MAX_BYTES: usize = 65536;
trait KeySource: Send + Sync {
    fn unlock(&self) -> Result<[u8; 32], String>;
}
struct Keychain;
impl KeySource for Keychain {
    fn unlock(&self) -> Result<[u8; 32], String> {
        let entry = keyring::Entry::new(SERVICE, &key_account()).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(encoded) => STANDARD_NO_PAD.decode(encoded).ok().and_then(|key| key.try_into().ok())
                .ok_or_else(|| "The app-permission encryption key is invalid.".into()),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0; 32]; OsRng.fill_bytes(&mut key);
                entry.set_password(&STANDARD_NO_PAD.encode(key)).map_err(|_| "Could not save the app-permission encryption key.")?;
                Ok(key)
            }
            Err(_) => Err("App permission storage is locked. Keychain access will not be requested again until Misty restarts.".into()),
        }
    }
}
struct Store {
    root: PathBuf,
    source: Box<dyn KeySource>,
    // Cache failure as well as success: denying one request must not open ten more.
    key: OnceLock<Result<[u8; 32], String>>,
    io: Mutex<()>,
}
impl Store {
    fn key(&self) -> Result<&[u8; 32], String> {
        self.key
            .get_or_init(|| self.source.unlock())
            .as_ref()
            .map_err(Clone::clone)
    }
    fn path(&self, owner: &str) -> PathBuf {
        self.root.join(format!(
            "{}.bin",
            hex::encode(Sha256::digest(owner.as_bytes()))
        ))
    }
    fn read(&self, owner: &str) -> Result<Option<String>, String> {
        let _io = self
            .io
            .lock()
            .map_err(|_| "Permission storage is unavailable.")?;
        let file = match fs::File::open(self.path(owner)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Could not read saved app permissions.".into()),
        };
        let mut bytes = Vec::new();
        file.take((MAX_BYTES + 64) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read saved app permissions.")?;
        if bytes.len() < 29 || bytes.len() > MAX_BYTES + 29 || bytes[0] != 1 {
            return Err("Invalid encrypted app permissions.".into());
        }
        let cipher =
            Aes256Gcm::new_from_slice(self.key()?).map_err(|_| "Invalid app-permission key.")?;
        let value = cipher
            .decrypt(
                Nonce::from_slice(&bytes[1..13]),
                Payload {
                    msg: &bytes[13..],
                    aad: owner.as_bytes(),
                },
            )
            .map_err(|_| "Saved app permissions could not be authenticated.".to_string())?;
        String::from_utf8(value)
            .map(Some)
            .map_err(|_| "Invalid saved app permissions.".into())
    }
    fn write(&self, owner: &str, value: &str) -> Result<(), String> {
        if value.len() > MAX_BYTES {
            return Err("App permission record is too large.".into());
        }
        let _io = self
            .io
            .lock()
            .map_err(|_| "Permission storage is unavailable.")?;
        let cipher =
            Aes256Gcm::new_from_slice(self.key()?).map_err(|_| "Invalid app-permission key.")?;
        let mut nonce = [0; 12];
        OsRng.fill_bytes(&mut nonce);
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: value.as_bytes(),
                    aad: owner.as_bytes(),
                },
            )
            .map_err(|_| "Could not encrypt app permissions.")?;
        fs::create_dir_all(&self.root).map_err(|_| "Could not create app permission storage.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Could not protect app permission storage.")?;
        }
        let mut file = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|_| "Could not save app permissions.")?;
        file.write_all(&[1])
            .and_then(|_| file.write_all(&nonce))
            .and_then(|_| file.write_all(&encrypted))
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "Could not save app permissions.")?;
        file.persist(self.path(owner))
            .map_err(|_| "Could not replace app permissions.")?;
        Ok(())
    }
}
fn store() -> Result<&'static Store, String> {
    static STORE: OnceLock<Result<Store, String>> = OnceLock::new();
    STORE
        .get_or_init(|| {
            Ok(Store {
                root: root()?,
                source: Box::new(Keychain),
                key: OnceLock::new(),
                io: Mutex::new(()),
            })
        })
        .as_ref()
        .map_err(Clone::clone)
}
pub(super) fn read(owner: &str) -> Result<Option<String>, String> {
    if let Some(value) = store()?.read(owner)? {
        return Ok(Some(value));
    }
    if let Some(value) = legacy(owner) {
        store()?.write(owner, &value)?;
        return Ok(Some(value));
    }
    Ok(None)
}
#[cfg(target_os = "macos")]
fn legacy(owner: &str) -> Option<String> {
    unsafe extern "C" {
        fn misty_permission_read_legacy(owner: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    }
    let owner = std::ffi::CString::new(owner).ok()?;
    unsafe {
        let value = misty_permission_read_legacy(owner.as_ptr());
        if value.is_null() {
            return None;
        }
        let result = std::ffi::CStr::from_ptr(value)
            .to_str()
            .ok()
            .map(str::to_owned);
        libc::free(value.cast());
        result
    }
}
#[cfg(not(target_os = "macos"))]
fn legacy(_: &str) -> Option<String> {
    None
}
fn key_account() -> String {
    #[cfg(test)]
    if let Ok(account) = std::env::var("MISTY_CONSENT_TEST_KEY") {
        return account;
    }
    KEY_ACCOUNT.into()
}
fn root() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Ok(path) = std::env::var("MISTY_CONSENT_TEST_ROOT") {
        return Ok(path.into());
    }
    Ok(dirs::data_local_dir()
        .ok_or("App data directory is unavailable.")?
        .join("com.misty.desktop/native-app-permissions-v2"))
}

pub(super) fn write(owner: &str, value: &str) -> Result<(), String> {
    store()?.write(owner, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    struct Keys {
        calls: Arc<AtomicUsize>,
        fail: bool,
    }
    impl KeySource for Keys {
        fn unlock(&self) -> Result<[u8; 32], String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err("Denied".into())
            } else {
                Ok([7; 32])
            }
        }
    }
    #[test]
    fn ten_concurrent_apps_and_repeated_reads_and_writes_share_one_unlock() {
        let root = tempfile::tempdir().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let store = Arc::new(Store {
            root: root.path().into(),
            source: Box::new(Keys {
                calls: calls.clone(),
                fail: false,
            }),
            key: OnceLock::new(),
            io: Mutex::new(()),
        });
        let tasks: Vec<_> = (0..10)
            .map(|n| {
                let store = store.clone();
                std::thread::spawn(move || {
                    let owner = format!("owner-{n}");
                    store.write(&owner, "private consent").unwrap();
                    for _ in 0..3 {
                        assert_eq!(
                            store.read(&owner).unwrap().as_deref(),
                            Some("private consent")
                        );
                    }
                    store.write(&owner, "revoked").unwrap();
                })
            })
            .collect();
        for task in tasks {
            task.join().unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let disk = fs::read(store.path("owner-0")).unwrap();
        assert!(!String::from_utf8_lossy(&disk).contains("revoked"));
        fs::copy(store.path("owner-0"), store.path("foreign")).unwrap();
        assert!(store.read("foreign").is_err());
        let reopened = Store {
            root: root.path().into(),
            source: Box::new(Keys {
                calls: calls.clone(),
                fail: false,
            }),
            key: OnceLock::new(),
            io: Mutex::new(()),
        };
        assert_eq!(
            reopened.read("owner-0").unwrap().as_deref(),
            Some("revoked")
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn concurrent_restore_denial_is_cached_and_preserves_saved_records() {
        let root = tempfile::tempdir().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let writer = Store {
            root: root.path().into(),
            source: Box::new(Keys {
                calls: calls.clone(),
                fail: false,
            }),
            key: OnceLock::new(),
            io: Mutex::new(()),
        };
        for n in 0..10 {
            writer.write(&format!("owner-{n}"), "grant").unwrap();
        }
        calls.store(0, Ordering::SeqCst);
        let reader = Arc::new(Store {
            root: root.path().into(),
            source: Box::new(Keys {
                calls: calls.clone(),
                fail: true,
            }),
            key: OnceLock::new(),
            io: Mutex::new(()),
        });
        let tasks: Vec<_> = (0..10)
            .map(|n| {
                let reader = reader.clone();
                std::thread::spawn(move || {
                    assert_eq!(reader.read(&format!("owner-{n}")).unwrap_err(), "Denied")
                })
            })
            .collect();
        for task in tasks {
            task.join().unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 10);
        assert_eq!(writer.read("owner-0").unwrap().as_deref(), Some("grant"));
    }
    #[test]
    fn denial_is_shared_without_retrying_keychain_or_writing_records() {
        let root = tempfile::tempdir().unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let store = Store {
            root: root.path().into(),
            source: Box::new(Keys {
                calls: calls.clone(),
                fail: true,
            }),
            key: OnceLock::new(),
            io: Mutex::new(()),
        };
        for n in 0..10 {
            assert_eq!(
                store.write(&format!("owner-{n}"), "grant").unwrap_err(),
                "Denied"
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
}
