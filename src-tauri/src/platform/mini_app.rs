//! Host-owned lifetimes and grants for workers bundled with Misty.
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State, Webview};
#[path = "mini_app_permissions.rs"]
pub mod permissions;

#[derive(Default)]
pub struct MiniAppState(Mutex<HashMap<String, Instance>>);
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<MiniAppState>() {
        if let Ok(mut registry) = state.0.lock() {
            registry.clear();
        }
    }
}
struct Instance {
    root: PathBuf,
    permissions: permissions::PermissionSet,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOwner {
    pub account_id: String,
    #[serde(default)]
    pub space_id: Option<String>,
    #[serde(default)]
    pub deployment: Option<String>,
    #[serde(default)]
    pub authority_generation: Option<u64>,
}

impl NativeOwner {
    fn namespace(&self, root: &Path) -> Result<String, String> {
        let valid = |value: &str| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };
        if !valid(&self.account_id) || self.space_id.as_deref().is_some_and(|space| !valid(space)) {
            return Err("Invalid Host account or Space identity.".into());
        }
        if let Some(deployment) = &self.deployment {
            let url = url::Url::parse(deployment).map_err(|_| "Invalid native deployment.")?;
            if deployment.len() > 4096
                || !matches!(url.scheme(), "https" | "http")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err("Invalid native deployment.".into());
            }
        }
        if self
            .authority_generation
            .is_some_and(|generation| generation == 0 || generation > 9_007_199_254_740_991)
        {
            return Err("Invalid native authority generation.".into());
        }
        use sha2::{Digest, Sha256};
        let mut digest = Sha256::new();
        digest.update(b"misty-native-owner-v2");
        if self.space_id.is_some() && self.deployment.is_none() {
            return Err("A Space app must identify its deployment.".into());
        }
        // The canonical installation root distinguishes private/public packages
        // and installations. Length prefixes avoid concatenation ambiguity.
        for part in [
            self.deployment.as_deref().unwrap_or("").as_bytes(),
            root.to_string_lossy().as_bytes(),
            self.account_id.as_bytes(),
            self.space_id.as_deref().unwrap_or("").as_bytes(),
        ] {
            digest.update((part.len() as u64).to_le_bytes());
            digest.update(part);
        }
        Ok(hex::encode(digest.finalize()))
    }
}

fn require_host(view: &Webview) -> Result<(), String> {
    if view.label() == "main" {
        Ok(())
    } else {
        Err("Only the Host can manage App views.".into())
    }
}

/// Built-in workers are compiled into Misty. Only its host webview may create
/// a scoped lifetime; there is no caller-selected package path or executable.
#[tauri::command]
pub fn builtin_service_open(
    webview: Webview,
    state: State<'_, MiniAppState>,
    tool: String,
    purpose: String,
    mut owner: NativeOwner,
) -> Result<String, String> {
    require_host(&webview)?;
    if owner.space_id.is_some() || owner.deployment.is_none() {
        return Err("A built-in service requires an account and deployment.".into());
    }
    // Built-in device identity is stable across Misty releases. Account reset
    // closes the instance and cancels its leases, independently of this identity.
    owner.authority_generation = Some(1);
    let root = PathBuf::from("misty-builtin").join(&tool);
    let mut permissions = permissions::PermissionSet::builtin(&tool, &purpose)?;
    permissions.owner_namespace = Some(owner.namespace(&root)?);
    permissions.native_owner = Some(owner);
    permissions.account_owned = true;
    let label = format!("misty-builtin-{}", uuid::Uuid::new_v4());
    state
        .0
        .lock()
        .map_err(|_| "Service registry unavailable.")?
        .insert(
            label.clone(),
            Instance {
                root,
                permissions,

            },
        );
    Ok(label)
}

#[tauri::command]
pub fn mini_app_close(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
) -> Result<(), String> {
    require_host(&webview)?;
    // Drop pending operations before closing, so late answers cannot cross instances.
    let removed = state
        .0
        .lock()
        .map_err(|_| "App registry unavailable.")?
        .remove(&instance);
    if removed.is_some() {
        if let Some(view) = app.get_webview(&instance) {
            view.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn search_process_command(
    executable: &std::path::Path,
    work: &std::path::Path,
    index: &std::path::Path,
) -> std::io::Result<std::process::Command> {
    permissions::search_process_command(executable, work, index)
}

#[cfg(all(test, target_os = "macos"))]
mod builtin_integration_tests {
    use super::*;
    use permissions::document_processing::ServiceLease;

    #[tokio::test]
    async fn builtin_lease_uses_embedded_bytes_and_revokes_on_close() {
        let state = MiniAppState::default();
        let owner = NativeOwner {
            account_id: "test-account".into(),
            space_id: None,
            deployment: Some("https://misty.example/api".into()),
            authority_generation: Some(1),
        };
        // This path deliberately does not exist: no installed package is needed.
        let root = PathBuf::from("misty-builtin/files");
        let mut permissions = permissions::PermissionSet::builtin("files", "documents").unwrap();
        permissions.owner_namespace = Some(owner.namespace(&root).unwrap());
        permissions.native_owner = Some(owner);
        permissions.account_owned = true;
        state.0.lock().unwrap().insert(
            "test".into(),
            Instance {
                root,
                permissions,

            },
        );
        let lease = ServiceLease::acquire(&state, "test", "files")
            .await
            .unwrap();
        assert!(lease.worker.len() > 1024);
        let input = tempfile::tempdir().unwrap();
        let document = input.path().join("sample.txt");
        std::fs::write(&document, "Built-in document processing works.").unwrap();
        let result = lease.process(&document, "semanticText").unwrap();
        assert!(result["semantic"]["text"].as_str().unwrap().contains("Built-in document processing"));
        assert!(ServiceLease::acquire(&state, "test", "library")
            .await
            .is_err());
        state.0.lock().unwrap().remove("test");
        assert!(lease.validate(&state, "test").is_err());
        tokio::task::yield_now().await;
        assert!(lease.cancelled());
    }
}
