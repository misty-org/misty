//! Encrypted secrets in `misty.db`. Each value is sealed with XChaCha20-Poly1305 under
//! the master key, with a fresh nonce, and bound to its (profile, service, account) so a
//! row cannot be moved to another slot. Blocking: call from a native worker.
use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng, Payload},
    AeadCore, XChaCha20Poly1305, XNonce,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::io;
use zeroize::Zeroizing;

const MAX_BYTES: usize = 4 * 1024 * 1024;

fn other<E: std::error::Error + Send + Sync + 'static>(error: E) -> io::Error {
    io::Error::other(error)
}

fn open_database() -> io::Result<Connection> {
    let connection = Connection::open(super::database_path()?).map_err(other)?;
    prepare(&connection)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            super::database_path()?,
            std::fs::Permissions::from_mode(0o600),
        )?;
    }
    Ok(connection)
}

fn prepare(connection: &Connection) -> io::Result<()> {
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(other)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA secure_delete = ON;
             CREATE TABLE IF NOT EXISTS secrets (
                 profile TEXT NOT NULL,
                 service TEXT NOT NULL,
                 account TEXT NOT NULL,
                 nonce BLOB NOT NULL,
                 ciphertext BLOB NOT NULL,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (profile, service, account)
             ) WITHOUT ROWID;",
        )
        .map_err(other)
}

fn aad(profile: &str, service: &str, account: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    for part in [profile, service, account] {
        // Length prefixes keep (a, bc) and (ab, c) distinct.
        bytes.extend_from_slice(&(part.len() as u64).to_be_bytes());
        bytes.extend_from_slice(part.as_bytes());
    }
    bytes
}

pub(crate) fn seal(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> io::Result<(Vec<u8>, Vec<u8>)> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| io::Error::other("Could not encrypt the credential"))?;
    Ok((nonce.to_vec(), ciphertext))
}

pub(crate) fn open(
    key: &[u8; 32],
    aad: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
) -> io::Result<Zeroizing<Vec<u8>>> {
    if nonce.len() != 24 {
        return Err(io::Error::other("Invalid credential nonce"));
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| {
            io::Error::other(
                "A saved credential could not be decrypted with this device's key. \
                 Sign in again.",
            )
        })
}

pub fn load(service: &str, account: &str) -> io::Result<Option<String>> {
    let connection = open_database()?;
    load_in(
        &connection,
        &*super::master_key::get()?,
        &super::profile(),
        service,
        account,
    )
}

pub fn store(service: &str, account: &str, value: &str) -> io::Result<()> {
    let connection = open_database()?;
    store_in(
        &connection,
        &*super::master_key::get()?,
        &super::profile(),
        service,
        account,
        value,
    )
}

pub fn delete(service: &str, account: &str) -> io::Result<()> {
    let connection = open_database()?;
    delete_in(&connection, &super::profile(), service, account)
}

fn load_in(
    connection: &Connection,
    key: &[u8; 32],
    profile: &str,
    service: &str,
    account: &str,
) -> io::Result<Option<String>> {
    let row: Option<(Vec<u8>, Vec<u8>)> = connection
        .query_row(
            "SELECT nonce, ciphertext FROM secrets WHERE profile = ?1 AND service = ?2 AND account = ?3",
            params![profile, service, account],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(other)?;
    let Some((nonce, ciphertext)) = row else {
        return Ok(None);
    };
    let plaintext = open(key, &aad(profile, service, account), &nonce, &ciphertext)?;
    String::from_utf8(plaintext.to_vec())
        .map(Some)
        .map_err(|_| io::Error::other("A saved credential is not valid text"))
}

fn store_in(
    connection: &Connection,
    key: &[u8; 32],
    profile: &str,
    service: &str,
    account: &str,
    value: &str,
) -> io::Result<()> {
    if value.len() > MAX_BYTES {
        return Err(io::Error::other("Credential too large"));
    }
    let (nonce, ciphertext) = seal(key, &aad(profile, service, account), value.as_bytes())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs() as i64);
    connection
        .execute(
            "INSERT INTO secrets (profile, service, account, nonce, ciphertext, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (profile, service, account)
             DO UPDATE SET nonce = ?4, ciphertext = ?5, updated_at = ?6",
            params![profile, service, account, nonce, ciphertext, now],
        )
        .map_err(other)?;
    Ok(())
}

fn delete_in(
    connection: &Connection,
    profile: &str,
    service: &str,
    account: &str,
) -> io::Result<()> {
    connection
        .execute(
            "DELETE FROM secrets WHERE profile = ?1 AND service = ?2 AND account = ?3",
            params![profile, service, account],
        )
        .map_err(other)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        prepare(&connection).unwrap();
        connection
    }

    #[test]
    fn round_trips_and_replaces_and_deletes() {
        let (connection, key) = (database(), *super::super::master_key::random_for_tests());
        assert_eq!(
            load_in(&connection, &key, "p", "svc", "acct").unwrap(),
            None
        );
        store_in(&connection, &key, "p", "svc", "acct", "first").unwrap();
        store_in(&connection, &key, "p", "svc", "acct", "second").unwrap();
        assert_eq!(
            load_in(&connection, &key, "p", "svc", "acct")
                .unwrap()
                .as_deref(),
            Some("second")
        );
        delete_in(&connection, "p", "svc", "acct").unwrap();
        assert_eq!(
            load_in(&connection, &key, "p", "svc", "acct").unwrap(),
            None
        );
    }

    #[test]
    fn rows_are_ciphertext_and_scoped_to_their_slot() {
        let (connection, key) = (database(), *super::super::master_key::random_for_tests());
        store_in(&connection, &key, "p", "svc", "acct", "super-secret-token").unwrap();
        let stored: Vec<u8> = connection
            .query_row("SELECT ciphertext FROM secrets", [], |row| row.get(0))
            .unwrap();
        assert!(!stored.windows(18).any(|w| w == b"super-secret-token"));
        // The same bytes cannot be read back through another profile, service or account.
        connection
            .execute("UPDATE secrets SET account = 'other'", [])
            .unwrap();
        assert!(load_in(&connection, &key, "p", "svc", "other").is_err());
    }

    #[test]
    fn a_wrong_key_or_tampered_row_is_refused() {
        let (connection, key) = (database(), *super::super::master_key::random_for_tests());
        store_in(&connection, &key, "p", "svc", "acct", "value").unwrap();
        let wrong = *super::super::master_key::random_for_tests();
        assert!(load_in(&connection, &wrong, "p", "svc", "acct").is_err());
        connection
            .execute(
                "UPDATE secrets SET ciphertext = zeroblob(length(ciphertext))",
                [],
            )
            .unwrap();
        assert!(load_in(&connection, &key, "p", "svc", "acct").is_err());
    }

    #[test]
    fn profiles_are_separate() {
        let (connection, key) = (database(), *super::super::master_key::random_for_tests());
        store_in(&connection, &key, "dev1", "svc", "acct", "one").unwrap();
        assert_eq!(
            load_in(&connection, &key, "dev2", "svc", "acct").unwrap(),
            None
        );
    }
}
