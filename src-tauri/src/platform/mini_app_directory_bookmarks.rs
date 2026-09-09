//! Private per-installation/account/Space bookmark records. Apps see opaque IDs,
//! never filesystem identities or the private credential-store key.
use super::super::MiniAppState;
use super::{directory_bookmark_macos as platform, file_jobs::FolderGrant, PermissionSet};
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
const SERVICE: &str = "misty.native-app.directory-bookmarks.v1";
const MAX_RECORDS: usize = 32;
const MAX_BYTES: usize = 262144;
static STORE_LOCK: Mutex<()> = Mutex::new(());

trait Vault {
    fn load(&self, key: &str) -> Result<Option<String>, String>;
    fn store(&self, key: &str, value: &str) -> Result<(), String>;
}
struct OsVault;
impl Vault for OsVault {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(SERVICE, key)
            .map_err(|_| "The OS credential vault is unavailable.")?
            .get_password()
        {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read saved folder access from the OS vault.".into()),
        }
    }
    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, key)
            .map_err(|_| "The OS credential vault is unavailable.")?
            .set_password(value)
            .map_err(|_| "Could not save folder access in the OS vault.".into())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    identity: platform::Identity,
    name: String,
    writable: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Store {
    schema: u8,
    records: BTreeMap<String, Record>,
}
fn load(vault: &dyn Vault, owner: &str) -> Result<Store, String> {
    if owner.len() != 64 || !owner.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Saved folders require an identified Host account and Space.".into());
    }
    let Some(value) = vault.load(owner)? else {
        return Ok(Store {
            schema: 1,
            records: BTreeMap::new(),
        });
    };
    if value.len() > MAX_BYTES {
        return Err("The saved folder store exceeds its limit.".into());
    }
    let store: Store =
        serde_json::from_str(&value).map_err(|_| "The saved folder store is invalid.")?;
    if store.schema != 1
        || store.records.len() > MAX_RECORDS
        || store
            .records
            .iter()
            .any(|(id, r)| uuid::Uuid::parse_str(id).is_err() || r.name.len() > 1024)
    {
        return Err("The saved folder store is invalid.".into());
    }
    Ok(store)
}
fn save(vault: &dyn Vault, owner: &str, store: &Store) -> Result<(), String> {
    let value = serde_json::to_string(store).map_err(|_| "The saved folder store is invalid.")?;
    if value.len() > MAX_BYTES {
        return Err("Forget an old saved folder before remembering another.".into());
    }
    vault.store(owner, &value)
}
fn forget(vault: &dyn Vault, owner: &str, id: &str) -> Result<(), String> {
    let _lock = STORE_LOCK
        .lock()
        .map_err(|_| "The folder bookmark store is unavailable.")?;
    let mut store = load(vault, owner)?;
    if store.records.remove(id).is_some() {
        save(vault, owner, &store)?;
    }
    Ok(())
}
enum Operation {
    List,
    Remember {
        handle: String,
        directory: Arc<Dir>,
        released: Arc<AtomicBool>,
        name: String,
    },
    Reopen {
        id: String,
    },
    Forget {
        id: String,
    },
}
struct Request {
    owner: String,
    writable: bool,
    epoch: u64,
    cancellation: tokio::sync::watch::Receiver<u64>,
    operation: Operation,
}
enum Output {
    Listed(Value),
    Remembered { id: String, name: String },
    Opened { directory: Dir, name: String },
    Forgotten,
}
impl Request {
    fn assert(&self) -> Result<(), String> {
        if self.cancellation.has_changed().unwrap_or(true)
            || matches!(&self.operation,Operation::Remember{released,..} if released.load(Ordering::Acquire))
        {
            return Err("Folder permission was revoked or the App closed.".into());
        }
        Ok(())
    }
    fn run(&self, vault: &dyn Vault) -> Result<Output, String> {
        self.assert()?;
        match &self.operation {
            Operation::List => {
                let _lock = STORE_LOCK
                    .lock()
                    .map_err(|_| "The folder bookmark store is unavailable.")?;
                let records = load(vault, &self.owner)?.records.into_iter().map(|(id,record)|
                    json!({"bookmarkId":id,"name":record.name,"writable":record.writable})).collect::<Vec<_>>();
                self.assert()?;
                Ok(Output::Listed(json!(records)))
            }
            Operation::Forget { id } => {
                forget(vault, &self.owner, id)?;
                Ok(Output::Forgotten)
            }
            Operation::Remember {
                directory, name, ..
            } => {
                let identity = platform::remember(directory)?;
                self.assert()?;
                let id = uuid::Uuid::new_v4().to_string();
                {
                    let _lock = STORE_LOCK
                        .lock()
                        .map_err(|_| "The folder bookmark store is unavailable.")?;
                    let mut store = load(vault, &self.owner)?;
                    if store.records.len() >= MAX_RECORDS {
                        return Err("Forget an old saved folder before remembering another.".into());
                    }
                    self.assert()?;
                    store.records.insert(
                        id.clone(),
                        Record {
                            identity,
                            name: name.clone(),
                            writable: self.writable,
                        },
                    );
                    save(vault, &self.owner, &store)?;
                }
                if let Err(error) = self.assert() {
                    forget(vault, &self.owner, &id)?;
                    return Err(error);
                }
                Ok(Output::Remembered {
                    id,
                    name: name.clone(),
                })
            }
            Operation::Reopen { id } => {
                let record = {
                    let _lock = STORE_LOCK
                        .lock()
                        .map_err(|_| "The folder bookmark store is unavailable.")?;
                    load(vault, &self.owner)?
                        .records
                        .get(id)
                        .cloned()
                        .ok_or("This saved folder is unavailable. Choose it again.")?
                };
                if self.writable && !record.writable {
                    return Err("This folder was remembered read-only.".into());
                }
                let directory = platform::reopen(&record.identity)?;
                self.assert()?;
                Ok(Output::Opened {
                    directory,
                    name: record.name,
                })
            }
        }
    }
    fn commit(&self, permissions: &mut PermissionSet, output: Output) -> Result<Value, String> {
        self.assert()?;
        if permissions.epoch != self.epoch
            || permissions.owner_namespace.as_deref() != Some(&self.owner)
        {
            return Err("Folder permission changed while restoring access.".into());
        }
        if !matches!(self.operation, Operation::Forget { .. }) {
            permissions.authorize(if self.writable {
                "files.write"
            } else {
                "files.read"
            })?;
        }
        match output {
            Output::Listed(records) => Ok(records),
            Output::Remembered { id, name } => {
                if let Operation::Remember {
                    handle, directory, ..
                } = &self.operation
                {
                    if !permissions
                        .folders
                        .get(handle)
                        .is_some_and(|f| Arc::ptr_eq(&f.directory, directory))
                    {
                        return Err("The chosen folder was released.".into());
                    }
                }
                Ok(json!({"bookmarkId":id,"name":name,"writable":self.writable}))
            }
            Output::Opened { directory, name } => {
                if permissions.folders.len() >= 32 {
                    return Err("Release an open folder before reopening another.".into());
                }
                let handle = uuid::Uuid::new_v4().to_string();
                permissions.folders.insert(
                    handle.clone(),
                    FolderGrant {
                        directory: Arc::new(directory),
                        name: name.clone(),
                        writable: self.writable,
                        released: Arc::new(AtomicBool::new(false)),
                    },
                );
                Ok(json!({"handle":handle,"name":name,"writable":self.writable}))
            }
            Output::Forgotten => Ok(Value::Null),
        }
    }
}
fn prepare(permissions: &PermissionSet, method: &str, params: &Value) -> Result<Request, String> {
    let owner = permissions
        .owner_namespace
        .clone()
        .ok_or("Saved folders require an identified Host account and Space.")?;
    let writable = match params.get("write") {
        None | Some(Value::Bool(false)) => false,
        Some(Value::Bool(true)) => true,
        _ => return Err("Invalid saved folder access.".into()),
    };
    if method != "files.forgetDirectory" {
        permissions.authorize(if writable {
            "files.write"
        } else {
            "files.read"
        })?;
    }
    let operation = if method == "files.listSavedDirectories" {
        if !params.as_object().is_some_and(|value| value.is_empty()) {
            return Err("Invalid saved folder listing request.".into());
        }
        Operation::List
    } else if method == "files.rememberDirectory" {
        let handle = params
            .get("directory")
            .and_then(Value::as_str)
            .ok_or("Missing folder handle.")?;
        let folder = permissions
            .folders
            .get(handle)
            .ok_or("This folder is not granted to this App.")?;
        if writable && !folder.writable {
            return Err("This folder was granted read-only.".into());
        }
        Operation::Remember {
            handle: handle.into(),
            directory: folder.directory.clone(),
            released: folder.released.clone(),
            name: folder.name.clone(),
        }
    } else {
        let id = params
            .get("bookmarkId")
            .and_then(Value::as_str)
            .and_then(|s| uuid::Uuid::parse_str(s).ok())
            .ok_or("Invalid saved folder identifier.")?
            .to_string();
        match method {
            "files.reopenDirectory" => Operation::Reopen { id },
            "files.forgetDirectory" => Operation::Forget { id },
            _ => return Err("Unknown saved folder method.".into()),
        }
    };
    Ok(Request {
        owner,
        writable,
        epoch: permissions.epoch,
        cancellation: permissions.cancellation.subscribe(),
        operation,
    })
}
pub async fn execute(
    state: &MiniAppState,
    instance: &str,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let request = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        Arc::new(prepare(
            &registry.get(instance).ok_or("App is closed.")?.permissions,
            method,
            params,
        )?)
    };
    static WORKERS: std::sync::OnceLock<Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let slot = WORKERS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(4)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Other folder restoration operations are running. Try again shortly.")?;
    let worker = request.clone();
    let output = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        worker.run(&OsVault)
    })
    .await
    .map_err(|_| "Folder restoration stopped unexpectedly.")??;
    let rollback = match &output {
        Output::Remembered { id, .. } => Some(id.clone()),
        _ => None,
    };
    let result = {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        match registry.get_mut(instance) {
            Some(entry) => request.commit(&mut entry.permissions, output),
            None => Err("App is closed.".into()),
        }
    };
    if result.is_err() {
        if let Some(id) = rollback {
            let owner = request.owner.clone();
            tokio::task::spawn_blocking(move || forget(&OsVault, &owner, &id))
                .await
                .map_err(|_| "Folder cleanup stopped unexpectedly.")??;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct MemoryVault(Mutex<BTreeMap<String, String>>);
    impl Vault for MemoryVault {
        fn load(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn store(&self, key: &str, value: &str) -> Result<(), String> {
            self.0.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
    }
    fn permissions(owner: &str) -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "code",
            &json!({"runtime_capabilities":["files.read","files.write"]}),
            None,
        )
        .unwrap();
        p.owner_namespace = Some(owner.into());
        p.decide("files.read", true).unwrap();
        p.decide("files.write", true).unwrap();
        p
    }
    fn fixture() -> (tempfile::TempDir, PermissionSet) {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        std::fs::write(root.path().join("project/file.txt"), "original").unwrap();
        let mut p = permissions(&"a".repeat(64));
        p.folders.insert(
            "folder".into(),
            FolderGrant {
                directory: Arc::new(
                    Dir::open_ambient_dir(
                        root.path().join("project"),
                        cap_std::ambient_authority(),
                    )
                    .unwrap(),
                ),
                name: "Project".into(),
                writable: true,
                released: Arc::new(AtomicBool::new(false)),
            },
        );
        (root, p)
    }
    fn call(
        p: &mut PermissionSet,
        v: &dyn Vault,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        let r = prepare(p, method, &params)?;
        let output = r.run(v)?;
        r.commit(p, output)
    }
    #[test]
    fn listing_is_private_owner_scoped_bounded_and_revocable() {
        let (_root, mut first) = fixture();
        let vault = MemoryVault::default();
        let saved = call(
            &mut first,
            &vault,
            "files.rememberDirectory",
            json!({"directory":"folder","write":false}),
        )
        .unwrap();
        assert_eq!(
            call(&mut first, &vault, "files.listSavedDirectories", json!({})).unwrap(),
            json!([saved])
        );
        let mut other = permissions(&"b".repeat(64));
        assert_eq!(
            call(&mut other, &vault, "files.listSavedDirectories", json!({})).unwrap(),
            json!([])
        );
        assert!(prepare(&first, "files.listSavedDirectories", &json!({"write":true})).is_err());
        assert!(prepare(&first, "files.listSavedDirectories", &Value::Null).is_err());
        let pending = prepare(&first, "files.listSavedDirectories", &json!({})).unwrap();
        let output = pending.run(&vault).unwrap();
        first.decide("files.read", false).unwrap();
        assert!(pending.commit(&mut first, output).is_err());
        assert!(prepare(&first, "files.listSavedDirectories", &json!({})).is_err());
        // Forget remains available after access is revoked, but cannot affect another owner.
        call(
            &mut first,
            &vault,
            "files.forgetDirectory",
            json!({"bookmarkId":saved["bookmarkId"]}),
        )
        .unwrap();
        first.decide("files.read", true).unwrap();
        assert_eq!(
            call(&mut first, &vault, "files.listSavedDirectories", json!({})).unwrap(),
            json!([])
        );
    }
    #[test]
    fn persists_only_private_records_and_reopens_after_registration_closes() {
        let (root, mut first) = fixture();
        let vault = MemoryVault::default();
        let saved = call(
            &mut first,
            &vault,
            "files.rememberDirectory",
            json!({"directory":"folder","write":true}),
        )
        .unwrap();
        assert_eq!(saved.as_object().unwrap().len(), 3);
        assert!(saved.get("bookmark").is_none());
        drop(first);
        let mut next = permissions(&"a".repeat(64));
        let opened = call(
            &mut next,
            &vault,
            "files.reopenDirectory",
            json!({"bookmarkId":saved["bookmarkId"],"write":true}),
        )
        .unwrap();
        let grant = &next.folders[opened["handle"].as_str().unwrap()];
        grant.directory.write("file.txt", "restored").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("project/file.txt")).unwrap(),
            "restored"
        );
        call(
            &mut next,
            &vault,
            "files.forgetDirectory",
            json!({"bookmarkId":saved["bookmarkId"]}),
        )
        .unwrap();
        assert!(call(
            &mut next,
            &vault,
            "files.reopenDirectory",
            json!({"bookmarkId":saved["bookmarkId"]})
        )
        .is_err());
        // Forget removes saved access; already-open independently owned grants survive.
        assert_eq!(
            next.folders[opened["handle"].as_str().unwrap()]
                .directory
                .read_to_string("file.txt")
                .unwrap(),
            "restored"
        );
    }
    #[test]
    fn identity_access_and_store_limits_are_checked_without_ambient_paths() {
        let (_root, mut first) = fixture();
        let vault = MemoryVault::default();
        let saved = call(
            &mut first,
            &vault,
            "files.rememberDirectory",
            json!({"directory":"folder","write":false}),
        )
        .unwrap();
        let mut other = permissions(&"b".repeat(64));
        assert!(call(
            &mut other,
            &vault,
            "files.reopenDirectory",
            json!({"bookmarkId":saved["bookmarkId"]})
        )
        .is_err());
        call(
            &mut other,
            &vault,
            "files.forgetDirectory",
            json!({"bookmarkId":saved["bookmarkId"]}),
        )
        .unwrap();
        assert!(call(
            &mut first,
            &vault,
            "files.reopenDirectory",
            json!({"bookmarkId":saved["bookmarkId"],"write":true})
        )
        .is_err());
        assert!(call(
            &mut first,
            &vault,
            "files.reopenDirectory",
            json!({"bookmarkId":"/etc"})
        )
        .is_err());
        for _ in 1..MAX_RECORDS {
            call(
                &mut first,
                &vault,
                "files.rememberDirectory",
                json!({"directory":"folder"}),
            )
            .unwrap();
        }
        assert!(call(
            &mut first,
            &vault,
            "files.rememberDirectory",
            json!({"directory":"folder"})
        )
        .is_err());
        first.decide("files.read", false).unwrap();
        assert!(prepare(
            &first,
            "files.reopenDirectory",
            &json!({"bookmarkId":saved["bookmarkId"]})
        )
        .is_err());
    }
    #[test]
    fn rejects_released_source_and_late_restoration_after_revocation() {
        let (_root, mut p) = fixture();
        let vault = MemoryVault::default();
        let saved = call(
            &mut p,
            &vault,
            "files.rememberDirectory",
            json!({"directory":"folder"}),
        )
        .unwrap();
        let request = prepare(
            &p,
            "files.rememberDirectory",
            &json!({"directory":"folder"}),
        )
        .unwrap();
        p.folders.remove("folder");
        assert!(request.run(&vault).is_err());
        let reopening = prepare(
            &p,
            "files.reopenDirectory",
            &json!({"bookmarkId":saved["bookmarkId"]}),
        )
        .unwrap();
        let output = reopening.run(&vault).unwrap();
        p.decide("files.read", false).unwrap();
        assert!(reopening.commit(&mut p, output).is_err());
        assert!(p.folders.is_empty());
    }
    #[test]
    fn malformed_private_record_fails_closed() {
        let (_root, mut p) = fixture();
        let vault = MemoryVault::default();
        vault.store(&"a".repeat(64), "{not JSON").unwrap();
        assert!(call(
            &mut p,
            &vault,
            "files.reopenDirectory",
            json!({"bookmarkId":uuid::Uuid::new_v4().to_string()})
        )
        .is_err());
    }
    #[test]
    #[ignore = "requires explicitly enabled disposable OS credential-vault verification"]
    fn os_vault_reopens_the_native_bookmark_in_a_fresh_process() {
        assert_eq!(
            std::env::var("MISTY_SDK_BOOKMARK_VAULT_TEST").as_deref(),
            Ok("1")
        );
        let (root, mut p) = fixture();
        let owner = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        p.owner_namespace = Some(owner.clone());
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = keyring::Entry::new(SERVICE, &self.0).and_then(|e| e.delete_credential());
            }
        }
        let _cleanup = Cleanup(owner.clone());
        let saved = call(
            &mut p,
            &OsVault,
            "files.rememberDirectory",
            json!({"directory":"folder","write":true}),
        )
        .unwrap();
        drop(p);
        std::fs::rename(root.path().join("project"), root.path().join("moved")).unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        let output=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","platform::mini_app::permissions::directory_bookmarks::tests::bookmark_child_process","--nocapture"])
            .env("MISTY_SDK_BOOKMARK_CHILD_OWNER",&owner).env("MISTY_SDK_BOOKMARK_CHILD_ID",saved["bookmarkId"].as_str().unwrap()).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join("moved/restored-by-child.txt")).unwrap(),
            "original"
        );
        assert!(!root.path().join("project/restored-by-child.txt").exists());
        let entry = keyring::Entry::new(SERVICE, &owner).unwrap();
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
    #[test]
    fn bookmark_child_process() {
        let Ok(owner) = std::env::var("MISTY_SDK_BOOKMARK_CHILD_OWNER") else {
            return;
        };
        assert_eq!(
            std::env::var("MISTY_SDK_BOOKMARK_VAULT_TEST").as_deref(),
            Ok("1")
        );
        let id = std::env::var("MISTY_SDK_BOOKMARK_CHILD_ID").unwrap();
        let mut p = permissions(&owner);
        assert_eq!(
            call(&mut p, &OsVault, "files.listSavedDirectories", json!({})).unwrap(),
            json!([{"bookmarkId":id,"name":"Project","writable":true}])
        );
        let opened = call(
            &mut p,
            &OsVault,
            "files.reopenDirectory",
            json!({"bookmarkId":id,"write":true}),
        )
        .unwrap();
        let dir = &p.folders[opened["handle"].as_str().unwrap()].directory;
        let text = dir.read_to_string("file.txt").unwrap();
        dir.write("restored-by-child.txt", text).unwrap();
    }
}
