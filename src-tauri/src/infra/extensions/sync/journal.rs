//! The encrypted local outbox of an installation's extension storage values.
use super::*;
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rusqlite::OptionalExtension;

const KEY_SERVICE: &str = "com.misty.extensions.journal";
#[derive(Default, Serialize, Deserialize)]
pub(super) struct Journal {
    #[serde(default)]
    pub(super) initialized: bool,
    pub(super) values: BTreeMap<String, Value>,
    pub(super) pending: BTreeMap<String, Value>,
}
pub(super) fn journal_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}
pub(super) fn ciphers() -> &'static std::sync::Mutex<BTreeMap<String, Aes256Gcm>> {
    static CIPHERS: OnceLock<std::sync::Mutex<BTreeMap<String, Aes256Gcm>>> = OnceLock::new();
    CIPHERS.get_or_init(Default::default)
}
fn db() -> Result<rusqlite::Connection, String> {
    let home =
        crate::infra::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    crate::infra::store::Store::at(home.join(".local").join("data").join("misty.db"))
        .connect()
        .map_err(|e| e.to_string())
}
fn slot(installation: &Installation) -> String {
    format!("{}-{}", installation.id, installation.generation)
}
pub(super) fn remove_local(
    _app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<(), String> {
    db()?
        .execute(
            "DELETE FROM extension_journal WHERE account = ?1 AND installation = ?2",
            [account, &slot(installation)],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn cipher(account: &str) -> Result<Aes256Gcm, String> {
    let mut cache = ciphers()
        .lock()
        .map_err(|_| "The extension key store is unavailable.")?;
    if let Some(cipher) = cache.get(account) {
        return Ok(cipher.clone());
    }
    let name = identity(account);
    let key = zeroize::Zeroizing::new(
        match crate::infra::credential_store::load(KEY_SERVICE, &name).map_err(|e| e.to_string())? {
            Some(value) => {
                hex::decode(value).map_err(|_| "The extension sync journal key is invalid.")?
            }
            None => {
                use rand::RngCore;
                let mut key = zeroize::Zeroizing::new([0u8; 32]);
                rand::rngs::OsRng.fill_bytes(key.as_mut());
                crate::infra::credential_store::store(
                    KEY_SERVICE,
                    &name,
                    &hex::encode(key.as_ref()),
                )
                .map_err(|e| e.to_string())?;
                key.to_vec()
            }
        },
    );
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "The extension sync journal cannot be opened.")?;
    cache.insert(account.to_owned(), cipher.clone());
    Ok(cipher)
}
/// Whether this installation generation already has a journal.
pub(super) fn journal_exists(
    _app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<bool, String> {
    db()?
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM extension_journal WHERE account = ?1 AND installation = ?2)",
            [account, &slot(installation)],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
}
pub(super) fn read(
    _app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<Journal, String> {
    let bytes: Option<Vec<u8>> = db()?
        .query_row(
            "SELECT sealed FROM extension_journal WHERE account = ?1 AND installation = ?2",
            [account, &slot(installation)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(bytes) = bytes else {
        return Ok(Journal::default());
    };
    if bytes.len() < 28 {
        return Err("The extension sync journal is incomplete.".into());
    }
    let plain = zeroize::Zeroizing::new(
        cipher(account)?
            .decrypt(
                Nonce::from_slice(&bytes[..12]),
                aes_gcm::aead::Payload {
                    msg: &bytes[12..],
                    aad: format!("{account}:{}:{}", installation.id, installation.generation)
                        .as_bytes(),
                },
            )
            .map_err(|_| "The extension sync journal failed its integrity check.")?,
    );
    serde_json::from_slice(&plain).map_err(|_| "The extension sync journal is invalid.".into())
}
pub(super) fn write(
    _app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
    journal: &Journal,
) -> Result<(), String> {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let plain = zeroize::Zeroizing::new(serde_json::to_vec(journal).map_err(|e| e.to_string())?);
    let mut sealed = nonce.to_vec();
    sealed.extend(
        cipher(account)?
            .encrypt(
                &nonce,
                aes_gcm::aead::Payload {
                    msg: &plain,
                    aad: format!("{account}:{}:{}", installation.id, installation.generation)
                        .as_bytes(),
                },
            )
            .map_err(|_| "Could not encrypt extension settings.")?,
    );
    db()?
        .execute(
            "INSERT INTO extension_journal (account, installation, sealed) VALUES (?1, ?2, ?3)
             ON CONFLICT (account, installation) DO UPDATE SET sealed = excluded.sealed",
            rusqlite::params![account, slot(installation), sealed],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
