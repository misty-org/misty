//! Private per-installation/account/Space bookmark records. Apps see opaque IDs,
//! never filesystem identities or the private credential-store key.
use super::super::MiniAppState;
use super::{directory_bookmark as platform, file_jobs::FolderGrant, PermissionSet};
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
const SERVICE: &str = "com.misty.native-app.directory-bookmarks.v1";
const MAX_RECORDS: usize = 32;
const MAX_BYTES: usize = 2097152;
static STORE_LOCK: Mutex<()> = Mutex::new(());

trait Vault {
    fn load(&self, key: &str) -> Result<Option<String>, String>;
    fn store(&self, key: &str, value: &str) -> Result<(), String>;
}
struct OsVault;
impl Vault for OsVault {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        crate::infra::credential_store::load(SERVICE, key).map_err(|error| error.to_string())
    }
    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        crate::infra::credential_store::store(SERVICE, key, value)
            .map_err(|error| error.to_string())
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
    Remembered {
        id: String,
        name: String,
    },
    Opened {
        directory: Dir,
        name: String,
        scope: Option<platform::SecurityScope>,
    },
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
                let (directory, scope) = platform::reopen_scoped(&record.identity)?;
                // Refresh stale bookmarks and migrate existing identity-only records.
                let identity = platform::remember(&directory)?;
                {
                    let _lock = STORE_LOCK
                        .lock()
                        .map_err(|_| "The folder bookmark store is unavailable.")?;
                    let mut store = load(vault, &self.owner)?;
                    let current = store
                        .records
                        .get_mut(id)
                        .ok_or("This saved folder was forgotten.")?;
                    current.identity = identity;
                    self.assert()?;
                    save(vault, &self.owner, &store)?;
                }
                self.assert()?;
                Ok(Output::Opened {
                    directory,
                    scope,
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
            Output::Opened {
                directory,
                name,
                scope,
            } => {
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
                if let Some(scope) = scope {
                    permissions
                        .folder_security_scopes
                        .insert(handle.clone(), Arc::new(scope));
                }
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
#[path = "mini_app_directory_bookmarks_tests.rs"]
mod tests;
