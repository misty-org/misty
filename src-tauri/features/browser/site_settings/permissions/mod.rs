//! Website camera, microphone and location permissions. Choices belong to the profile whose
//! pages use the browser store (private sessions keep theirs to themselves).
//! Kiri applies them in every engine; this module stores them and serves
//! Misty's site settings.
use kiri::engine::{self, LocationRequest, MediaRequest, StoreScope};
use kiri::permissions::{canonical_origin, location_verdict, media_verdict, Verdict};
pub use kiri::permissions::{Decision, SitePermissions as Permissions};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};

mod choices;
pub use choices::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPermission {
    pub profile: String,
    pub origin: String,
    pub permissions: Permissions,
}

/// A saved choice with the name of the profile whose store holds it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedPermission {
    #[serde(flatten)]
    pub saved: SavedPermission,
    pub profile_name: String,
}

/// Answers Kiri's engine hooks from the stored choices.
struct Policy {
    app: AppHandle,
}

impl Policy {
    /// The choices on the tab's store; `None` when the tab's store is unknown.
    fn sites(&self, store: &Option<StoreScope>, webview: &str) -> Option<SitePermissions> {
        let scope = store
            .clone()
            .or_else(|| session_scope(&self.app, webview))?;
        // Engines raise requests on the main thread, where the store is read.
        Some(unsafe { sites_for_scope(&scope) })
    }
}

impl engine::SitePolicy for Policy {
    fn media_verdict(&self, request: &MediaRequest) -> Verdict {
        let Some(sites) = self.sites(&request.store, &request.webview) else {
            return Verdict::Deny;
        };
        media_verdict(
            request.top_origin.as_deref(),
            request.requester_origin.as_deref(),
            request.kind,
            |origin| sites.get(origin).cloned().unwrap_or_default(),
        )
    }

    fn location_verdict(&self, request: &LocationRequest) -> Verdict {
        let Some(sites) = self.sites(&request.store, &request.webview) else {
            return Verdict::Deny;
        };
        location_verdict(
            request.top_origin.as_deref(),
            request.requester_origin.as_deref(),
            |origin| sites.get(origin).cloned().unwrap_or_default(),
        )
    }
}

pub(crate) fn init(app: &AppHandle) {
    engine::set_site_policy(Policy { app: app.clone() });
}

pub(crate) fn install(webview: &Webview) -> Result<(), String> {
    engine::install_site_permissions(webview)
}

/// The store a tab's choices live in, from the profile Misty opened it with.
/// WebKit reports its own store instead (see `PageFacts::store`).
fn session_scope(app: &AppHandle, label: &str) -> Option<StoreScope> {
    crate::browser::session_permission_scope(app, label.strip_prefix("misty-browser-")?)
}

fn require_host(caller: &Webview) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(caller.label())
        && !caller.label().starts_with("misty-agent-")
    {
        return Err("Only Misty's settings can change website permissions.".into());
    }
    Ok(())
}

/// The key a website data store is filed under, as WebKit's `UUIDString` writes it.
pub(crate) fn store_key(store: Option<&str>) -> Result<String, String> {
    let identifier = crate::browser::site_data::profile_store::data_store_identifier(store)?;
    Ok(uuid::Uuid::from_bytes(identifier)
        .hyphenated()
        .to_string()
        .to_uppercase())
}

mod db;
mod profile;
#[cfg(target_os = "macos")]
use macos::store;
pub(crate) use profile::seed_records;
// The Windows and Linux store, compiled and tested on macOS too.
#[cfg(any(not(target_os = "macos"), test))]
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod store_file;
use store::{read_store, sites_for_scope, write_store, SitePermissions};
#[cfg(not(target_os = "macos"))]
use store_file as store;

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(test)]
mod tests;
