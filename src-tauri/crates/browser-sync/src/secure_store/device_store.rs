//! A single device Keychain key; only authenticated ciphertext goes to SQLite.
use std::{fs, path::Path, time::Duration};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use zeroize::Zeroizing;

use crate::{Error, Result};

pub(super) const DEVICE_ACCOUNT: &str = "device-unlock:v2";
const CHECK_NAME: &str = "device-key-check:v2";
const CHECK_VALUE: &[u8] = b"Misty device key store v2";

pub(super) trait Backend {
    fn read(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>>;
    fn write(&self, account: &str, value: &[u8]) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
    fn legacy_accounts(&self) -> Result<Vec<String>>;
}

pub(super) struct DeviceStore {
    db: Connection,
    key: Zeroizing<Vec<u8>>,
}

fn legacy_name(name: &str) -> bool {
    let hash = name.strip_prefix("workspace-recovery:v1:").unwrap_or(name);
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

fn validate_root(bytes: &[u8]) -> Result<()> {
    if bytes.len() == 33 && bytes[0] == 1 {
        Ok(())
    } else {
        Err(Error::SecureStorage)
    }
}

fn random_root() -> Zeroizing<Vec<u8>> {
    let mut bytes = Zeroizing::new(vec![0; 33]);
    bytes[0] = 1;
    OsRng.fill_bytes(&mut bytes[1..]);
    bytes
}

fn aad(name: &str) -> Vec<u8> {
    // Names include both purpose and the canonical deployment/account/workspace
    // hash, so moving a ciphertext between accounts or purposes fails closed.
    format!("misty-device-key-store:v2:{name}").into_bytes()
}

fn encrypt(key: &[u8], name: &str, value: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| Error::SecureStorage)?;
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: value,
                aad: &aad(name),
            },
        )
        .map_err(|_| Error::SecureStorage)?;
    let mut envelope = vec![2];
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

fn decrypt(key: &[u8], name: &str, envelope: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if envelope.len() < 29 || envelope.len() > 128 || envelope[0] != 2 {
        return Err(Error::SecureStorage);
    }
    Aes256Gcm::new_from_slice(key)
        .map_err(|_| Error::SecureStorage)?
        .decrypt(
            Nonce::from_slice(&envelope[1..13]),
            Payload {
                msg: &envelope[13..],
                aad: &aad(name),
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| Error::SecureStorage)
}

fn read(db: &Connection, key: &[u8], name: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
    let value: Option<Vec<u8>> = db
        .query_row(
            "SELECT ciphertext FROM device_keys WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .optional()?;
    value.map(|bytes| decrypt(key, name, &bytes)).transpose()
}

fn write(db: &Connection, key: &[u8], name: &str, value: &[u8]) -> Result<()> {
    let encrypted = encrypt(key, name, value)?;
    db.execute(
        "INSERT INTO device_keys(name, ciphertext) VALUES (?1, ?2)
        ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext",
        params![name, encrypted],
    )?;
    Ok(())
}

impl DeviceStore {
    pub(super) fn open(directory: &Path, backend: &impl Backend) -> Result<Self> {
        fs::create_dir_all(directory).map_err(|_| Error::SecureStorage)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| Error::SecureStorage)?;
        }
        let path = directory.join("keys.sqlite");
        let mut db = Connection::open(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|_| Error::SecureStorage)?;
        }
        db.busy_timeout(Duration::from_secs(30))?;
        db.execute_batch("PRAGMA synchronous = FULL;
            CREATE TABLE IF NOT EXISTS device_keys(name TEXT PRIMARY KEY, ciphertext BLOB NOT NULL);")?;
        // Serialize first creation AND migration across dev profiles/processes.
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let key = match backend.read(DEVICE_ACCOUNT)? {
            Some(key) => {
                validate_root(&key)?;
                key
            }
            None => {
                let count: i64 =
                    tx.query_row("SELECT COUNT(*) FROM device_keys", [], |row| row.get(0))?;
                if count != 0 {
                    return Err(Error::SecureStorage);
                }
                let key = random_root();
                backend.write(DEVICE_ACCOUNT, &key)?;
                // Do not retire legacy keys until the OS confirms the master was saved.
                let saved = backend.read(DEVICE_ACCOUNT)?.ok_or(Error::SecureStorage)?;
                if *saved != *key {
                    return Err(Error::SecureStorage);
                }
                key
            }
        };
        match read(&tx, &key[1..], CHECK_NAME)? {
            Some(value) if value.as_slice() != CHECK_VALUE => return Err(Error::SecureStorage),
            Some(_) => {}
            None => {
                // A database containing roots but no verification record is not new.
                let count: i64 =
                    tx.query_row("SELECT COUNT(*) FROM device_keys", [], |row| row.get(0))?;
                if count != 0 {
                    return Err(Error::SecureStorage);
                }
                write(&tx, &key[1..], CHECK_NAME, CHECK_VALUE)?;
            }
        }
        let legacy = backend
            .legacy_accounts()?
            .into_iter()
            .filter(|name| legacy_name(name))
            .collect::<Vec<_>>();
        for name in &legacy {
            // A crash after commit but before Keychain deletion must not prompt
            // for the old secret again or overwrite its verified encrypted copy.
            if let Some(value) = read(&tx, &key[1..], name)? {
                validate_root(&value)?;
            } else if let Some(value) = backend.read(name)? {
                validate_root(&value)?;
                write(&tx, &key[1..], name, &value)?;
                let verified = read(&tx, &key[1..], name)?.ok_or(Error::SecureStorage)?;
                if *verified != *value {
                    return Err(Error::SecureStorage);
                }
            }
        }
        tx.commit()?;
        // Only committed, authenticated local copies may replace old OS entries.
        for name in legacy {
            backend.delete(&name)?;
        }
        Ok(Self { db, key })
    }

    pub(super) fn get(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let value = read(&self.db, &self.key[1..], name)?;
        if let Some(value) = &value {
            validate_root(value)?;
        }
        Ok(value)
    }

    pub(super) fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
        validate_root(bytes)?;
        write(&self.db, &self.key[1..], name, bytes)
    }

    pub(super) fn delete(&self, name: &str) -> Result<()> {
        self.db
            .execute("DELETE FROM device_keys WHERE name = ?1", [name])?;
        Ok(())
    }

    pub(super) fn recovery(&mut self, name: &str, create: bool) -> Result<Zeroizing<Vec<u8>>> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let root = match read(&tx, &self.key[1..], name)? {
            Some(value) => {
                validate_root(&value)?;
                value
            }
            None if create => {
                let value = random_root();
                write(&tx, &self.key[1..], name, &value)?;
                value
            }
            None => return Err(Error::SecureStorage),
        };
        tx.commit()?;
        Ok(root)
    }
}

#[cfg(test)]
mod tests;
