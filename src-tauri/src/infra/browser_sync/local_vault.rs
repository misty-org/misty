//! The local vault: the personal vault of a device with no synced one open, because
//! nobody is signed in or sync is not set up (docs/design/no-account-browsing/BRIEF.md).
//! It is the same encrypted store and records as a synced vault, with a root made on this
//! device and kept in Misty's credential store, and a worker that never connects. Saved
//! passwords live in it, so they work without an account.
use super::*;

/// A vault scope needs a deployment, and a worker an API client for it. Nothing is ever
/// sent there: a local worker never connects.
const LOCAL_DEPLOYMENT: &str = "https://local.misty.invalid";
const LOCAL_ACCOUNT: &str = "local";
/// One local vault per device.
const LOCAL_VAULT: &str = "0f3c1a52-6d7e-4b8a-9c41-2e5d7a9b3f60";

struct LocalVault {
    handle: WorkerHandle,
    task: JoinHandle<misty_browser_sync::Result<()>>,
    _database_lock: std::fs::File,
}

static LOCAL: OnceLock<Mutex<Option<LocalVault>>> = OnceLock::new();

fn scope() -> VaultScope {
    VaultScope {
        deployment: LOCAL_DEPLOYMENT.into(),
        account_id: LOCAL_ACCOUNT.into(),
        vault_id: LOCAL_VAULT.into(),
    }
}

/// The local vault's worker, opened on first use. None when the device's credential
/// store or data folder is unavailable.
pub(crate) async fn local_vault_handle() -> Option<WorkerHandle> {
    let mut local = LOCAL.get_or_init(|| Mutex::new(None)).lock().await;
    if let Some(open) = local.as_ref().filter(|open| !open.task.is_finished()) {
        return Some(open.handle.clone());
    }
    *local = None;
    let opened = open().await.ok()?;
    let handle = opened.handle.clone();
    *local = Some(opened);
    Some(handle)
}

async fn open() -> Result<LocalVault, String> {
    let _lifetime = browser_lifecycle().read().await;
    let scope = scope();
    let native_scope = scope.clone();
    let (root, store, device, database_lock) = tokio::task::spawn_blocking(move || {
        let path = database_path(
            &native_scope.deployment,
            &native_scope.account_id,
            &native_scope.vault_id,
        )?;
        let database_lock = lock_database(&path)?;
        let existing =
            Store::belongs_to_account(&path, &native_scope.deployment, &native_scope.account_id)
                .map_err(issue)?;
        let unlocked = if existing {
            secure_store::local_vault_root(&native_scope, false)
                .and_then(|root| {
                    let (store, device) = Store::unlock(&path, native_scope.clone(), &root)?;
                    Ok((root, store, device))
                })
                .ok()
        } else {
            None
        };
        let (root, store, device) = match unlocked {
            Some(opened) => opened,
            None => {
                // A database whose root is gone (a reset keychain) can never open again; it
                // is set aside, and the device starts a new local vault.
                if existing {
                    retire_database(&path).map_err(issue)?;
                    let _ = secure_store::forget_local_vault_root(&native_scope);
                }
                let root = secure_store::local_vault_root(&native_scope, true).map_err(issue)?;
                let device = DeviceKey::generate();
                let grant = root
                    .grant(&native_scope, &uuid::Uuid::new_v4().to_string(), 1, &device)
                    .map_err(issue)?;
                let store = Store::initialize_vault(
                    &path,
                    native_scope.clone(),
                    grant,
                    &root,
                    &device,
                    &Document::default().encode().map_err(issue)?,
                    None,
                )
                .map_err(issue)?;
                (root, store, device)
            }
        };
        store
            .pending_snapshot(&root, document::reduce)
            .map_err(issue)?;
        Ok::<_, String>((root, store, device, database_lock))
    })
    .await
    .map_err(|_| "Could not open this device's saved data".to_owned())??;
    let http = reqwest::Client::builder()
        .build()
        .map_err(|_| "Could not open this device's saved data")?;
    let api = SyncApi::new(LOCAL_DEPLOYMENT, http).map_err(issue)?;
    let (worker, handle) =
        Worker::new(api, scope, root, device, store, document::reduce).map_err(issue)?;
    let task = tokio::spawn(worker.local().run());
    Ok(LocalVault {
        handle,
        task,
        _database_lock: database_lock,
    })
}
