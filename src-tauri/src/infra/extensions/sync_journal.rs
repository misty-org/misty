//! The encrypted local outbox of an installation's extension storage values.
use super::*;
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};

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
pub(super) fn remove_local(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<(), String> {
    let path = journal_path(app, account, installation)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
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
pub(super) fn journal_path(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<PathBuf, String> {
    Ok(root(app, account)?.join("sync").join(format!(
        "{}-{}.sealed",
        installation.id, installation.generation
    )))
}
pub(super) fn read(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<Journal, String> {
    let path = journal_path(app, account, installation)?;
    if !path.exists() {
        return Ok(Journal::default());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
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
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
    journal: &Journal,
) -> Result<(), String> {
    let path = journal_path(app, account, installation)?;
    let parent = path.parent().ok_or("Invalid journal directory.")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
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
    let temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    std::fs::write(temp.path(), sealed).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
