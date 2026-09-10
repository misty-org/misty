//! Native-owned consent. Never persist handles, and never trust a renderer boolean.
use super::PermissionSet;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[path = "mini_app_permission_vault.rs"]
mod permission_vault;
#[cfg(test)]
const SERVICE: &str = "com.misty.native-app.permissions.v2";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    declaration: String,
    grants: BTreeSet<String>,
}
pub(super) trait Vault {
    fn read(&self, owner: &str) -> Result<Option<String>, String>;
    fn write(&self, owner: &str, value: &str) -> Result<(), String>;
}
pub(super) struct OsVault;
impl Vault for OsVault {
    fn read(&self, owner: &str) -> Result<Option<String>, String> {
        permission_vault::read(owner)
    }
    fn write(&self, owner: &str, value: &str) -> Result<(), String> {
        permission_vault::write(owner, value)
    }
}

#[derive(Clone)]
struct Snapshot {
    owner_namespace: Option<String>,
    consent_declaration: String,
    epoch: u64,
}
impl From<&PermissionSet> for Snapshot {
    fn from(p: &PermissionSet) -> Self {
        Self {
            owner_namespace: p.owner_namespace.clone(),
            consent_declaration: p.consent_declaration.clone(),
            epoch: p.epoch,
        }
    }
}
fn record(p: &Snapshot, vault: &dyn Vault) -> Result<Record, String> {
    let value = p
        .owner_namespace
        .as_deref()
        .map(|owner| vault.read(owner))
        .transpose()?
        .flatten();
    if let Some(value) = value {
        if value.len() > 65536 {
            return Err("Invalid saved app permissions.".into());
        }
        let record: Record =
            serde_json::from_str(&value).map_err(|_| "Invalid saved app permissions.")?;
        if record.declaration == p.consent_declaration && record.grants.len() <= 128 {
            return Ok(record);
        }
    }
    Ok(Record {
        declaration: p.consent_declaration.clone(),
        grants: BTreeSet::new(),
    })
}
#[cfg(test)]
pub(super) fn restore(p: &mut PermissionSet, vault: &dyn Vault) -> Result<(), String> {
    if p.consent_loaded {
        return Ok(());
    }
    for capability in record(&Snapshot::from(&*p), vault)?.grants {
        if !p.denied.contains(&capability) && p.declaration(&capability).is_ok() {
            p.granted.insert(capability);
        }
    }
    p.consent_loaded = true;
    Ok(())
}
fn save_snapshot(
    p: &Snapshot,
    capability: &str,
    allowed: bool,
    vault: &dyn Vault,
) -> Result<(), String> {
    let Some(owner) = p.owner_namespace.as_deref() else {
        return Ok(());
    };
    let mut record = record(p, vault)?;
    if allowed {
        record.grants.insert(capability.into());
    } else {
        record.grants.remove(capability);
    }
    vault.write(
        owner,
        &serde_json::to_string(&record).map_err(|e| e.to_string())?,
    )
}

#[cfg(test)]
fn save(
    p: &PermissionSet,
    capability: &str,
    allowed: bool,
    vault: &dyn Vault,
) -> Result<(), String> {
    save_snapshot(&Snapshot::from(p), capability, allowed, vault)
}
#[cfg(test)]

pub(super) fn decide(
    registry: &mut std::collections::HashMap<String, super::super::Instance>,
    instance: &str,
    capability: &str,
    allowed: bool,
    vault: &dyn Vault,
) -> Result<(Vec<String>, Result<(), String>), String> {
    let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
    p.declaration(capability)?;
    let owner = p.owner_namespace.clone();
    let declaration = p.consent_declaration.clone();
    // Serialize persistence and propagation with registration/device operations.
    // On vault failure a revocation still removes every live capability.
    let saved = save(p, capability, allowed, vault);
    if allowed {
        saved.as_ref().map_err(Clone::clone)?;
    }
    let mut revoked = Vec::new();
    for (id, entry) in registry.iter_mut() {
        let p = &mut entry.permissions;
        if id == instance
            || (owner.is_some()
                && p.owner_namespace == owner
                && (!allowed || p.consent_declaration == declaration))
        {
            if p.declaration(capability).is_ok() {
                p.decide(capability, allowed)?;
                if !allowed {
                    revoked.push(id.clone());
                }
            }
        }
    }
    Ok((revoked, saved))
}

// Serialize vault transactions without ever holding the app registry or UI thread
// while macOS waits for a password/approval. Cached reads bypass this queue.
static IO: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
type AsyncVault = std::sync::Arc<dyn Vault + Send + Sync>;
fn matches(p: &PermissionSet, snapshot: &Snapshot) -> bool {
    p.owner_namespace == snapshot.owner_namespace
        && p.consent_declaration == snapshot.consent_declaration
        && p.epoch == snapshot.epoch
}
pub(super) async fn restore_instance(
    state: &super::super::MiniAppState,
    instance: &str,
) -> Result<(), String> {
    restore_async(state, instance, std::sync::Arc::new(OsVault)).await
}
async fn restore_async(
    state: &super::super::MiniAppState,
    instance: &str,
    vault: AsyncVault,
) -> Result<(), String> {
    {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        if registry
            .get(instance)
            .ok_or("App is closed.")?
            .permissions
            .consent_loaded
        {
            return Ok(());
        }
    }
    let _io = IO.lock().await;
    let snapshot = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
        if p.consent_loaded {
            return Ok(());
        }
        Snapshot::from(p)
    };
    let work = snapshot.clone();
    let record = tauri::async_runtime::spawn_blocking(move || record(&work, vault.as_ref()))
        .await
        .map_err(|_| "Permission worker stopped.")??;
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let p = &mut registry
        .get_mut(instance)
        .ok_or("App is closed.")?
        .permissions;
    if !matches(p, &snapshot) {
        return Err("App permissions changed while restoring access.".into());
    }
    for capability in record.grants {
        if !p.denied.contains(&capability) && p.declaration(&capability).is_ok() {
            p.granted.insert(capability);
        }
    }
    p.consent_loaded = true;
    Ok(())
}
pub(super) async fn decide_instance(
    app: &tauri::AppHandle,
    state: &super::super::MiniAppState,
    instance: &str,
    capability: &str,
    allowed: bool,
) -> Result<(), String> {
    // Revoke live authority immediately, even when another Keychain dialog is pending.
    if !allowed {
        let revoked = {
            let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
            let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
            p.declaration(capability)?;
            let owner = p.owner_namespace.clone();
            let mut revoked = Vec::new();
            for (id, entry) in registry.iter_mut() {
                let p = &mut entry.permissions;
                if (id == instance || (owner.is_some() && p.owner_namespace == owner))
                    && p.declaration(capability).is_ok()
                {
                    p.decide(capability, false)?;
                    revoked.push(id.clone());
                }
            }
            revoked
        };
        use tauri::Emitter;
        for id in revoked {
            app.emit_to(
                tauri::EventTarget::webview("main"),
                "misty:mini-app-revoked",
                serde_json::json!({"instance":id,"capability":capability}),
            )
            .map_err(|e| e.to_string())?;
        }
    }
    persist_decision(
        state,
        instance,
        capability,
        allowed,
        std::sync::Arc::new(OsVault),
    )
    .await
}
async fn persist_decision(
    state: &super::super::MiniAppState,
    instance: &str,
    capability: &str,
    allowed: bool,
    vault: AsyncVault,
) -> Result<(), String> {
    // Capture before waiting: revocation while queued must invalidate approval.
    let snapshot = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
        p.declaration(capability)?;
        Snapshot::from(p)
    };
    let _io = IO.lock().await;
    if allowed {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        if !registry
            .get(instance)
            .is_some_and(|entry| matches(&entry.permissions, &snapshot))
        {
            return Err("App permissions changed before approval.".into());
        }
    }
    let work = snapshot.clone();
    let cap = capability.to_owned();
    let worker_vault = vault.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_snapshot(&work, &cap, allowed, worker_vault.as_ref())
    })
    .await
    .map_err(|_| "Permission worker stopped.")??;
    if !allowed {
        return Ok(());
    }
    let committed = {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        if registry
            .get(instance)
            .is_some_and(|entry| matches(&entry.permissions, &snapshot))
        {
            for (id, entry) in registry.iter_mut() {
                let p = &mut entry.permissions;
                if (id == instance
                    || (snapshot.owner_namespace.is_some()
                        && p.owner_namespace == snapshot.owner_namespace
                        && p.consent_declaration == snapshot.consent_declaration))
                    && p.declaration(capability).is_ok()
                {
                    p.decide(capability, true)?;
                }
            }
            true
        } else {
            false
        }
    };
    if !committed {
        let cap = capability.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            save_snapshot(&snapshot, &cap, false, vault.as_ref())
        })
        .await
        .map_err(|_| "Permission worker stopped.")??;
        return Err("App closed or permissions changed while approval was pending.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};
    #[derive(Default)]
    struct Memory(RefCell<HashMap<String, String>>);
    impl Vault for Memory {
        fn read(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(key).cloned())
        }
        fn write(&self, key: &str, value: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(key.into(), value.into());
            Ok(())
        }
    }
    fn app(owner: &str, scopes: serde_json::Value) -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "files",
            &serde_json::json!({"runtime_capabilities":scopes}),
            None,
        )
        .unwrap();
        p.owner_namespace = Some(owner.into());
        p
    }
    #[test]
    fn survives_reopen_but_not_account_or_declaration_changes_and_can_be_revoked() {
        let vault = Memory::default();
        let p = app("alice", serde_json::json!(["files.read"]));
        save(&p, "files.read", true, &vault).unwrap();
        let mut reopened = app("alice", serde_json::json!(["files.read"]));
        restore(&mut reopened, &vault).unwrap();
        assert!(reopened.authorize("files.read").is_ok());
        for mut other in [
            app("bob", serde_json::json!(["files.read"])),
            app("alice", serde_json::json!(["files.read", "files.write"])),
        ] {
            restore(&mut other, &vault).unwrap();
            assert!(other.authorize("files.read").is_err());
        }
        save(&reopened, "files.read", false, &vault).unwrap();
        let mut reopened = app("alice", serde_json::json!(["files.read"]));
        restore(&mut reopened, &vault).unwrap();
        assert!(reopened.authorize("files.read").is_err());
    }
    #[test]
    fn approval_and_revocation_propagate_to_matching_views_and_cancel_live_work() {
        let vault = Memory::default();
        let mut registry = HashMap::new();
        for (id, owner) in [("one", "alice"), ("two", "alice"), ("other", "bob")] {
            registry.insert(
                id.into(),
                super::super::super::Instance {
                    root: std::path::PathBuf::new(),
                    permissions: app(owner, serde_json::json!(["files.read"])),
                    _profile: None,
                    pending: HashMap::new(),
                },
            );
        }
        decide(&mut registry, "one", "files.read", true, &vault)
            .unwrap()
            .1
            .unwrap();
        assert!(registry["two"].permissions.authorize("files.read").is_ok());
        assert!(registry["other"]
            .permissions
            .authorize("files.read")
            .is_err());
        let cancellation = registry["two"].permissions.cancellation.subscribe();
        let (mut revoked, result) =
            decide(&mut registry, "one", "files.read", false, &vault).unwrap();
        result.unwrap();
        revoked.sort();
        assert_eq!(revoked, ["one", "two"]);
        assert!(cancellation.has_changed().unwrap());
        assert!(registry["two"].permissions.authorize("files.read").is_err());
        restore(&mut registry.get_mut("two").unwrap().permissions, &vault).unwrap();
        assert!(registry["two"].permissions.authorize("files.read").is_err());
    }

    #[test]
    fn restored_approval_never_exceeds_a_restricted_session() {
        let vault = Memory::default();
        let document = serde_json::json!({"runtime_capabilities":["files.read", "files.write"], "publisher":"original"});
        let mut p = PermissionSet::from_document("files", &document, None).unwrap();
        p.owner_namespace = Some("alice".into());
        save(&p, "files.write", true, &vault).unwrap();
        let mut limited =
            PermissionSet::from_document("files", &document, Some(&["files.read".into()])).unwrap();
        limited.owner_namespace = p.owner_namespace.clone();
        restore(&mut limited, &vault).unwrap();
        assert!(limited.authorize("files.write").is_err());
        let mut changed = document.clone();
        changed["publisher"] = serde_json::json!("replacement");
        let mut replacement = PermissionSet::from_document("files", &changed, None).unwrap();
        replacement.owner_namespace = p.owner_namespace.clone();
        restore(&mut replacement, &vault).unwrap();
        assert!(replacement.authorize("files.write").is_err());
    }
    #[test]
    #[ignore = "requires disposable OS credential-vault verification"]
    fn os_vault_restores_approval_in_a_fresh_process() {
        assert_eq!(
            std::env::var("MISTY_SDK_BOOKMARK_VAULT_TEST").as_deref(),
            Ok("1")
        );
        let owner = uuid::Uuid::new_v4().to_string();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = keyring::Entry::new(SERVICE, &self.0).and_then(|e| e.delete_credential());
            }
        }
        let _cleanup = Cleanup(owner.clone());
        let root = tempfile::tempdir().unwrap();
        std::env::set_var("MISTY_CONSENT_TEST_KEY", &owner);
        std::env::set_var("MISTY_CONSENT_TEST_ROOT", root.path());
        let p = app(&owner, serde_json::json!(["files.read"]));
        save(&p, "files.read", true, &OsVault).unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "platform::mini_app::permissions::remembered_permissions::tests::consent_child_process", "--nocapture"])
            .env("MISTY_CONSENT_CHILD_OWNER", &owner).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        save(&p, "files.read", false, &OsVault).unwrap();
        let mut reopened = app(&owner, serde_json::json!(["files.read"]));
        restore(&mut reopened, &OsVault).unwrap();
        assert!(reopened.authorize("files.read").is_err());
    }
    #[test]
    fn consent_child_process() {
        let Ok(owner) = std::env::var("MISTY_CONSENT_CHILD_OWNER") else {
            return;
        };
        assert_eq!(
            std::env::var("MISTY_SDK_BOOKMARK_VAULT_TEST").as_deref(),
            Ok("1")
        );
        let mut p = app(&owner, serde_json::json!(["files.read"]));
        restore(&mut p, &OsVault).unwrap();
        assert!(p.authorize("files.read").is_ok());
    }
    struct WaitingVault {
        entered: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        release: std::sync::Mutex<Option<std::sync::mpsc::Receiver<()>>>,
        value: std::sync::Mutex<Option<String>>,
    }
    impl Vault for WaitingVault {
        fn read(&self, _: &str) -> Result<Option<String>, String> {
            if let Some(release) = self.release.lock().unwrap().take() {
                self.entered
                    .lock()
                    .unwrap()
                    .take()
                    .unwrap()
                    .send(())
                    .unwrap();
                release
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .map_err(|_| "Test approval timed out")?;
            }
            Ok(self.value.lock().unwrap().clone())
        }
        fn write(&self, _: &str, value: &str) -> Result<(), String> {
            *self.value.lock().unwrap() = Some(value.into());
            Ok(())
        }
    }
    #[tokio::test]
    async fn pending_keychain_does_not_lock_registry_and_late_approval_cannot_restore_revoked_access(
    ) {
        let state = std::sync::Arc::new(super::super::super::MiniAppState::default());
        state.0.lock().unwrap().insert(
            "view".into(),
            super::super::super::Instance {
                root: std::path::PathBuf::new(),
                permissions: app("alice", serde_json::json!(["files.read"])),
                _profile: None,
                pending: HashMap::new(),
            },
        );
        let (entered, waiting) = tokio::sync::oneshot::channel();
        let (release, receiver) = std::sync::mpsc::channel();
        let vault = std::sync::Arc::new(WaitingVault {
            entered: std::sync::Mutex::new(Some(entered)),
            release: std::sync::Mutex::new(Some(receiver)),
            value: std::sync::Mutex::new(None),
        });
        let worker_state = state.clone();
        let worker_vault = vault.clone();
        let pending = tokio::spawn(async move {
            persist_decision(&worker_state, "view", "files.read", true, worker_vault).await
        });
        waiting.await.unwrap();
        // The event loop is running here while the blocking vault call waits.
        {
            let mut registry = state
                .0
                .try_lock()
                .expect("Keychain must not hold the registry");
            registry
                .get_mut("view")
                .unwrap()
                .permissions
                .decide("files.read", false)
                .unwrap();
        }
        release.send(()).unwrap();
        assert!(pending.await.unwrap().is_err());
        assert!(state.0.lock().unwrap()["view"]
            .permissions
            .authorize("files.read")
            .is_err());
        let saved: Record =
            serde_json::from_str(vault.value.lock().unwrap().as_ref().unwrap()).unwrap();
        assert!(saved.grants.is_empty());
    }
}
