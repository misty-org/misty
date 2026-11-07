//! Website camera, microphone and location permissions. Choices belong to the profile whose
//! pages use the browser store (private sessions keep theirs to themselves).
//! Kiri applies them in every engine; this module stores them and serves
//! Misty's site settings.
use kiri::engine::{self, AskAnswer, LocationRequest, MediaRequest, PermissionAsk, StoreScope};
use kiri::permissions::{canonical_origin, location_verdict, media_verdict, Verdict};
pub use kiri::permissions::{Decision, SitePermissions as Permissions};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};

mod ask;
mod choices;
pub use ask::*;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    url: String,
    origin: String,
    secure: bool,
    persistent: bool,
    profile: Option<String>,
    permissions: Permissions,
    /// macOS refuses Misty the device's location, so a site's allowance reaches nothing.
    location_blocked: bool,
    #[serde(skip)]
    scope: StoreScope,
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

    fn ask(&self, request: PermissionAsk, answer: AskAnswer) -> Result<(), AskAnswer> {
        ask::ask(&self.app, request, answer);
        Ok(())
    }
}

pub(crate) fn init(app: &AppHandle) {
    engine::set_site_policy(Policy { app: app.clone() });
}

pub(in crate::infra) fn install(webview: &Webview) -> Result<(), String> {
    engine::install_site_permissions(webview)
}

/// The store a tab's choices live in, from the profile Misty opened it with.
/// WebKit reports its own store instead (see `PageFacts::store`).
fn session_scope(app: &AppHandle, label: &str) -> Option<StoreScope> {
    super::super::browser::session_permission_scope(app, label.strip_prefix("misty-browser-")?)
}

/// The last private tab closed: its choices go with it. WebKit's private
/// store carries them itself, so this applies to the other engines.
pub(in crate::infra) fn forget_private_session() {
    #[cfg(not(target_os = "macos"))]
    store::forget_temporary();
}

fn require_host(caller: &Webview) -> Result<(), String> {
    if !crate::infra::profile_windows::is_person_window(caller.label())
        && !caller.label().starts_with("misty-agent-")
    {
        return Err("Only Misty's settings can change website permissions.".into());
    }
    Ok(())
}

fn target(app: &AppHandle, id: &str) -> Result<Webview, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Invalid browser tab.".into());
    }
    app.get_webview(&format!("misty-browser-{id}"))
        .ok_or("This browser tab has closed.".into())
}

/// Runs a store operation on the tab's UI thread while the tab is alive, so a
/// private store it refers to cannot be released underneath it.
async fn with_tab<T: Send + 'static>(
    view: &Webview,
    operation: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |_| {
        let _ = send.send(operation());
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "The browser closed while reading site settings.".to_owned())
}

async fn inspect(
    app: &AppHandle,
    view: Webview,
    expected_origin: Option<String>,
    update: Option<Permissions>,
) -> Result<SiteInfo, String> {
    let facts = engine::page_facts(&view).await?;
    let origin = canonical_origin(&facts.url)?;
    if expected_origin
        .as_ref()
        .is_some_and(|expected| expected != &origin)
    {
        return Err("The page changed. Reopen site settings and try again.".into());
    }
    let scope = facts
        .store
        .clone()
        .or_else(|| session_scope(app, view.label()))
        .ok_or("This browser tab has closed.")?;
    let (sites, location_blocked) = {
        let (scope, origin, update) = (scope.clone(), origin.clone(), update.clone());
        with_tab(&view, move || unsafe {
            let sites = match update {
                Some(update) => update_scope(&scope, &origin, update),
                None => Ok(sites_for_scope(&scope)),
            };
            sites.map(|sites| (sites, engine::location_blocked_by_system()))
        })
        .await??
    };
    if let (Some(update), StoreScope::Persistent(profile)) = (update, &scope) {
        profile::publish(profile.clone(), [(origin.clone(), update)].into());
    }
    let profile = match &scope {
        StoreScope::Persistent(profile) => Some(profile.clone()),
        StoreScope::Temporary(_) => None,
    };
    Ok(SiteInfo {
        url: facts.url,
        permissions: sites.get(&origin).cloned().unwrap_or_default(),
        origin,
        secure: facts.secure,
        persistent: profile.is_some(),
        profile,
        location_blocked,
        scope,
    })
}

#[tauri::command]
pub async fn browser_site_info(
    caller: Webview,
    app: AppHandle,
    id: String,
) -> Result<SiteInfo, String> {
    require_host(&caller)?;
    inspect(&app, target(&app, &id)?, None, None).await
}

/// The key a website data store is filed under, as WebKit's `UUIDString` writes it.
pub(in crate::infra) fn store_key(store: Option<&str>) -> Result<String, String> {
    let identifier = super::super::profile_store::data_store_identifier(store)?;
    Ok(uuid::Uuid::from_bytes(identifier)
        .hyphenated()
        .to_string()
        .to_uppercase())
}

/// Camera, microphone and location decisions imported from another browser, for one
/// Misty browser profile. Only sites still set to Ask change, so a choice
/// already made in Misty always wins. Returns how many decisions were added.
pub(crate) fn import_decisions(
    profile: Option<&str>,
    decisions: &[(String, &str, bool)],
) -> Result<usize, String> {
    let key = store_key(profile)?;
    let mut store = read_store();
    let sites = store.entry(key.clone()).or_default();
    let mut added = 0;
    let mut changed = std::collections::BTreeMap::new();
    for (origin, kind, allow) in decisions {
        let Ok(origin) = canonical_origin(origin) else {
            continue;
        };
        let entry = sites.entry(origin.clone()).or_default();
        let slot = match *kind {
            "camera" => &mut entry.camera,
            "microphone" => &mut entry.microphone,
            "location" => &mut entry.location,
            _ => continue,
        };
        if *slot == Decision::Ask {
            *slot = if *allow {
                Decision::Allow
            } else {
                Decision::Block
            };
            added += 1;
            changed.insert(origin, entry.clone());
        }
    }
    sites.retain(|_, permissions| *permissions != Permissions::default());
    write_store(&store)?;
    profile::publish(key, changed);
    Ok(added)
}

mod db;
mod profile;
pub(crate) use profile::{follow_remote_changes, seed_records};
#[cfg(target_os = "macos")]
mod store_macos;
#[cfg(target_os = "macos")]
use store_macos as store;
// The Windows and Linux store, compiled and tested on macOS too.
#[cfg(any(not(target_os = "macos"), test))]
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod store_file;
use store::{read_store, sites_for_scope, update_scope, write_store, SitePermissions};
#[cfg(not(target_os = "macos"))]
use store_file as store;

#[cfg(test)]
mod tests;
