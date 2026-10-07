//! Website camera and microphone permissions. Choices are local to this app and
//! browser profile. Kiri applies them in every engine; this module stores them
//! and serves Misty's site settings.
use kiri::engine::{self, MediaRequest, StoreScope};
use kiri::permissions::{canonical_origin, media_verdict, Verdict};
pub use kiri::permissions::{Decision, MediaPermissions as Permissions};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPermission {
    pub profile: String,
    pub origin: String,
    pub permissions: Permissions,
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
    #[serde(skip)]
    scope: StoreScope,
}

/// Answers Kiri's engine hooks from the stored choices.
struct Policy {
    app: AppHandle,
}

impl engine::MediaPolicy for Policy {
    fn media_verdict(&self, request: &MediaRequest) -> Verdict {
        let Some(scope) = request
            .store
            .clone()
            .or_else(|| session_scope(&self.app, &request.webview))
        else {
            return Verdict::Deny;
        };
        // Engines raise these on the main thread, where the store is read.
        let sites = unsafe { sites_for_scope(&scope) };
        media_verdict(
            request.top_origin.as_deref(),
            request.requester_origin.as_deref(),
            request.kind,
            |origin| sites.get(origin).cloned().unwrap_or_default(),
        )
    }
}

pub(crate) fn init(app: &AppHandle) {
    engine::set_media_policy(Policy { app: app.clone() });
}

pub(super) fn install(webview: &Webview) -> Result<(), String> {
    engine::install_media_permissions(webview)
}

/// The store a tab's choices live in, from the profile Misty opened it with.
/// WebKit reports its own store instead (see `PageFacts::store`).
fn session_scope(app: &AppHandle, label: &str) -> Option<StoreScope> {
    super::browser::session_permission_scope(app, label.strip_prefix("misty-browser-")?)
}

/// The last private tab closed: its choices go with it. WebKit's private
/// store carries them itself, so this applies to the other engines.
pub(super) fn forget_private_session() {
    #[cfg(not(target_os = "macos"))]
    store::forget_temporary();
}

fn require_host(caller: &Webview) -> Result<(), String> {
    if caller.label() != "main" && !caller.label().starts_with("misty-agent-") {
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
    let sites = {
        let (scope, origin) = (scope.clone(), origin.clone());
        with_tab(&view, move || unsafe {
            match update {
                Some(update) => update_scope(&scope, &origin, update),
                None => Ok(sites_for_scope(&scope)),
            }
        })
        .await??
    };
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

// Stop capture in every browser view on the store. This includes third-party frames and
// other tabs whose current top-level URL does not reveal the origin of an active stream.
async fn stop_capture(
    app: &AppHandle,
    affected_scope: &StoreScope,
    camera: bool,
    microphone: bool,
) -> Result<(), String> {
    for (label, webview) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        // WebKit compares its own store; other engines rely on Misty's profiles.
        if !cfg!(target_os = "macos") && session_scope(app, &label).as_ref() != Some(affected_scope)
        {
            continue;
        }
        engine::stop_capture(&webview, Some(affected_scope), camera, microphone)
            .await
            .map_err(|error| {
                let mut letters = error.chars();
                let first = letters.next().map(|c| c.to_lowercase().to_string()).unwrap_or_default();
                format!("Permission saved, but {first}{}", letters.as_str())
            })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_site_permissions_set(
    caller: Webview,
    app: AppHandle,
    id: String,
    origin: String,
    permissions: Permissions,
) -> Result<SiteInfo, String> {
    require_host(&caller)?;
    let before = inspect(&app, target(&app, &id)?, Some(canonical_origin(&origin)?), None).await?;
    let info = inspect(
        &app,
        target(&app, &id)?,
        Some(canonical_origin(&origin)?),
        Some(permissions.clone()),
    )
    .await?;
    stop_capture(
        &app,
        &info.scope,
        permissions.camera != Decision::Allow && permissions.camera != before.permissions.camera,
        permissions.microphone != Decision::Allow
            && permissions.microphone != before.permissions.microphone,
    )
    .await?;
    Ok(info)
}

/// Profiles with an open tab. Dormant profiles of another signed-in account stay hidden.
fn active_profiles(app: &AppHandle) -> std::collections::HashSet<String> {
    app.webviews()
        .into_keys()
        .filter_map(|label| match session_scope(app, &label)? {
            StoreScope::Persistent(profile) => Some(profile),
            StoreScope::Temporary(_) => None,
        })
        .collect()
}

#[tauri::command]
pub async fn browser_site_permissions_list(
    caller: Webview,
    app: AppHandle,
) -> Result<Vec<SavedPermission>, String> {
    require_host(&caller)?;
    let active = active_profiles(&app);
    Ok(read_store()
        .into_iter()
        .filter(|(profile, _)| active.contains(profile))
        .flat_map(|(profile, sites)| {
            sites
                .into_iter()
                .map(move |(origin, permissions)| SavedPermission {
                    profile: profile.clone(),
                    origin,
                    permissions,
                })
        })
        .collect())
}

#[tauri::command]
pub async fn browser_site_permissions_reset(
    caller: Webview,
    app: AppHandle,
    profile: String,
    origin: String,
) -> Result<(), String> {
    require_host(&caller)?;
    let origin = canonical_origin(&origin)?;
    if !active_profiles(&app).contains(&profile) {
        return Err("Open a tab in this browser profile before resetting its permissions.".into());
    }
    // Serialize all store read/modify/write operations on the main thread.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let affected_profile = profile.clone();
    app.run_on_main_thread(move || {
        let mut store = read_store();
        if let Some(sites) = store.get_mut(&profile) {
            sites.remove(&origin);
        }
        let _ = tx.send(write_store(&store));
    })
    .map_err(|error| error.to_string())?;
    rx.await
        .map_err(|_| "Could not reset website permissions.".to_owned())??;
    stop_capture(&app, &StoreScope::Persistent(affected_profile), true, true).await
}

/// The store key for a Misty browser profile, as WebKit's `UUIDString` writes it.
pub(super) fn profile_key(profile: Option<&str>) -> Result<String, String> {
    let identifier = super::browser_profile::data_store_identifier(profile)?;
    Ok(uuid::Uuid::from_bytes(identifier)
        .hyphenated()
        .to_string()
        .to_uppercase())
}

/// Camera and microphone decisions imported from another browser, for one
/// Misty browser profile. Only sites still set to Ask change, so a choice
/// already made in Misty always wins. Returns how many decisions were added.
pub(crate) fn import_decisions(
    profile: Option<&str>,
    decisions: &[(String, &str, bool)],
) -> Result<usize, String> {
    let key = profile_key(profile)?;
    let mut store = read_store();
    let sites = store.entry(key).or_default();
    let mut added = 0;
    for (origin, kind, allow) in decisions {
        let Ok(origin) = canonical_origin(origin) else {
            continue;
        };
        let entry = sites.entry(origin).or_default();
        let slot = if *kind == "camera" {
            &mut entry.camera
        } else {
            &mut entry.microphone
        };
        if *slot == Decision::Ask {
            *slot = if *allow {
                Decision::Allow
            } else {
                Decision::Block
            };
            added += 1;
        }
    }
    sites.retain(|_, permissions| *permissions != Permissions::default());
    write_store(&store)?;
    Ok(added)
}

#[cfg(target_os = "macos")]
#[path = "browser_site_permissions_store.rs"]
mod store;
#[cfg(not(target_os = "macos"))]
#[path = "browser_site_permissions_store_file.rs"]
mod store;
use store::{read_store, sites_for_scope, update_scope, write_store};
// The Windows and Linux store, compiled and tested on macOS too.
#[cfg(all(test, target_os = "macos"))]
#[path = "browser_site_permissions_store_file.rs"]
mod file_store;

#[cfg(test)]
#[path = "browser_site_permissions_tests.rs"]
mod tests;
