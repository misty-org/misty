//! Loading committed packages into the native extension runtime, reconciling
//! them with the account's installations, and checking for updates.
use super::install::{commit, prepare};
use super::*;
use crate::infra::file_access::fs;

mod actions;
pub use actions::*;
mod updates;
pub use updates::*;

async fn activate(
    app: &tauri::AppHandle,
    account: &str,
    profile: &str,
    installation: &Installation,
) -> Result<InstalledState, String> {
    let id = installation.id.clone();
    let package_root = root(app, account, profile)?.join("packages").join(&id);
    let removed = service(profile).lock().await.removed.contains(&id);
    if !installation.enabled || removed {
        native::request(json!({"operation":"unload","account":account,"space":profile,"id":id}))
            .await?;
        service(profile).lock().await.loaded.remove(&id);
        sync::forget(account, profile, &id);
        drop_origin(profile, &installation_host(account, &installation.guid));
        let review = selected_package(&package_root, false)
            .ok()
            .and_then(|path| read_review(&path).ok());
        return Ok(InstalledState {
            new_tab: None,
            id,
            status: (if removed {
                "needs-attention"
            } else {
                "disabled"
            })
            .into(),
            version: review.as_ref().map(|v| v.entry.version.clone()),
            detail: removed.then(|| catalog::REMOVED.to_owned()),
            review,
        });
    }
    let mut review = selected_package(&package_root, false)
        .ok()
        .and_then(|path| read_review(&path).ok());
    if review.is_none() {
        let prepared = prepare(app, account, profile, &id).await?;
        if prepared.entry.guid != installation.guid
            || prepared.blocked
            || prepared
                .permissions
                .iter()
                .any(|p| !installation.permissions.contains(p))
            || prepared
                .hosts
                .iter()
                .any(|p| !installation.hosts.contains(p))
        {
            return Ok(InstalledState {
                new_tab: None,
                id,
                status: "needs-review".into(),
                version: None,
                detail: Some("Review this version's permissions before installing it here.".into()),
                review: Some(prepared),
            });
        }
        review = Some(commit(app, profile, &prepared.token).await?);
    }
    let review = review.ok_or("The installed package is missing.")?;
    let current = selected_package(&package_root, false)?;
    if review.blocked {
        return Err("This package requires unavailable browser APIs.".into());
    }
    if review.entry.guid != installation.guid {
        return Err("Installed package identity does not match the account.".into());
    }
    let signature = identity(
        &serde_json::to_string(&(installation, &review.entry.digest)).map_err(|e| e.to_string())?,
    );
    let origin = installation_origin(account, &installation.guid);
    if service(profile).lock().await.loaded.get(&id) != Some(&signature) {
        // Extension pages load from this host: the origin itself on macOS,
        // the extension ID derived from it on Windows.
        if let Some(host) = page_host(&origin) {
            allow_origin(profile, host);
        }
        sync::forget(account, profile, &id);
        // Packages installed before the compatibility layer existed gain it here.
        let _ = compat::apply(&current.join("runtime"));
        let result = native::request(json!({"operation":"load", "account":account,"space":profile,"id":id,"guid":installation.guid,
            "session":ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),"runtimePath":current.join("runtime"), "origin":origin,
            "privateAccess":installation.private_access,"permissions":installation.permissions,"hosts":installation.hosts})).await;
        if let Err(error) = result {
            // The current package is retained for diagnostics; retry the prior runtime when possible.
            if let Ok(previous) = selected_package(&package_root, true) {
                if let Ok(old) = read_review(&previous) {
                    let _ = compat::apply(&previous.join("runtime"));
                    let fallback = native::request(json!({"operation":"load", "account":account,"space":profile,"id":id,"guid":installation.guid,
                    "session":ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),"runtimePath":previous.join("runtime"),"origin":origin,
                    "privateAccess":installation.private_access,"permissions":installation.permissions,"hosts":installation.hosts})).await;
                    fallback.map_err(|failure| {
                        format!("The update and previous runtime both failed: {error}; {failure}")
                    })?;
                    return Ok(InstalledState {
                        new_tab: None,
                        id,
                        status: "needs-attention".into(),
                        version: Some(old.entry.version),
                        detail: Some(format!("The update could not load: {error}")),
                        review: Some(review),
                    });
                }
            }
            return Err(error);
        }
        service(profile)
            .lock()
            .await
            .loaded
            .insert(id.clone(), signature);
        prune_versions(&package_root);
    } else if let Some(previous) = service(profile).lock().await.states.get(&id).cloned() {
        if matches!(previous.status.as_str(), "needs-attention" | "needs-review") {
            return Ok(previous);
        }
    }
    Ok(InstalledState {
        new_tab: new_tab_page(&current.join("runtime"), &origin),
        id,
        status: "enabled".into(),
        version: Some(review.entry.version.clone()),
        detail: None,
        review: Some(review),
    })
}

/// An extension's new-tab page (`chrome_url_overrides.newtab`), as the address a
/// browser tab loads. Only a plain path inside the package counts.
fn new_tab_page(runtime: &Path, origin: &str) -> Option<String> {
    let manifest: Value =
        serde_json::from_slice(&fs::read(runtime.join("manifest.json")).ok()?).ok()?;
    let page = manifest
        .pointer("/chrome_url_overrides/newtab")?
        .as_str()?
        .trim_start_matches('/');
    let path = page.split(['?', '#']).next()?;
    let inside = !path.is_empty()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)));
    let host = page_host(origin)?;
    inside.then(|| format!("{EXTENSION_SCHEME}://{host}/{page}"))
}

/// The website data store a profile's pages open in, as `browser_webview_create` picks it.
#[cfg(target_os = "macos")]
async fn profile_store(
    profile: &str,
) -> Result<(crate::infra::profile_data::PageStore, String), String> {
    let lease = crate::infra::profile_data::page_store(profile).await?;
    let identifier = crate::infra::browser_profile::data_store_identifier(lease.store.as_deref())?;
    Ok((lease, uuid::Uuid::from_bytes(identifier).to_string()))
}

#[tauri::command]
pub async fn extensions_reconcile(
    caller: tauri::Webview,
    app: tauri::AppHandle,
    account: String,
    installations: Vec<Installation>,
    agent_access: bool,
) -> Result<Vec<InstalledState>, ExtensionFailure> {
    let result: Result<_,String> = async {
    let profile = native::caller_profile(&caller)?;
    if account.len() > 256 || (account.is_empty() && !installations.is_empty()) || installations.len() > 256 || !installations.iter().all(valid_installation) { return Err("Invalid extension account preferences.".into()); }
    // Acquire the browser lease before the extension lifecycle lock: account
    // teardown owns the opposite end of the browser lifecycle, never SESSION here.
    #[cfg(target_os="macos")]
    let (lease, store) = profile_store(&profile).await?;
    #[cfg(not(target_os="macos"))]
    let store = String::new();
    let _guard = lifecycle().lock().await;
    if CLOSING.load(std::sync::atomic::Ordering::Acquire) { return Err("The extension account changed.".into()); }
    native::initialize(&app);
    // Another account stops every profile; another profile of the same account starts beside the others.
    let account_changed = current_account().lock().map(|current| *current != account).unwrap_or(true);
    if account_changed {
        advance_epoch(); sync::reset();
        if let Ok(mut origins)=origins().write() { origins.clear(); }
        for other in profiles_running() { *service(&other).lock().await = ExtensionService::default(); }
        if let Ok(mut running)=running_profiles().lock() { running.clear(); }
        if let Ok(mut current)=current_account().lock() { *current = account.clone(); }
    }
    let changed = account_changed || service(&profile).lock().await.account != account;
    if changed {
        if !account.is_empty() && profile == crate::infra::profile_windows::PERSONAL { profiles::adopt_account_packages(&app, &account)?; }
        *service(&profile).lock().await = ExtensionService { account:account.clone(), ..Default::default() };
        if !account.is_empty() { if let Ok(mut running)=running_profiles().lock() { running.insert(profile.clone()); } }
    }
    if account.is_empty() { return Ok(Vec::new()); }
    native::request(json!({"operation":"configure", "account":account,"space":profile,"controllerId":controller_id(&account,&profile),"store":store})).await?;
    #[cfg(target_os="macos")]
    drop(lease);
    let absent = { let state=service(&profile).lock().await; state.desired.values().filter(|old|!installations.iter().any(|new|new.id==old.id)).cloned().collect::<Vec<_>>() };
    for old in absent {
        native::request(json!({"operation":"unload","account":account,"space":profile,"id":old.id})).await?;
        sync::forget(&account,&profile,&old.id);
        drop_origin(&profile, &installation_host(&account, &old.guid));
        let mut state=service(&profile).lock().await; state.states.remove(&old.id); state.loaded.remove(&old.id);
    }
    { let mut state = service(&profile).lock().await; state.desired = installations.iter().cloned().map(|v|(v.id.clone(),v)).collect(); state.agent_access = agent_access; }
    let reconcile_epoch=ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire);
    for installation in &installations {
        if ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire)!=reconcile_epoch { return Err("The extension account changed.".into()); }
        if !installation.installed {
            let _ = native::request(json!({"operation":"remove", "account":account,"space":profile,"id":installation.id,"guid":installation.guid})).await;
            sync::queue_removal(&app,&account,&profile,installation)?;
            sync::forget(&account,&profile,&installation.id);
            sync::clear_local(&app,&account,&profile,installation).await?;
            drop_origin(&profile, &installation_host(&account, &installation.guid));
            // Sync teardown can hold the account session lock; never await it while
            // holding the extension lifecycle lock used by account teardown.
            let removed=installation.clone(); let removed_profile=profile.clone();
            tauri::async_runtime::spawn(async move { sync::remove(&removed_profile,&removed).await; });
            let package = root(&app, &account, &profile)?.join("packages").join(&installation.id);
            if fs::exists(&package) { fs::remove_dir_all(package).map_err(|e| e.to_string())?; }
            let mut state = service(&profile).lock().await; state.states.remove(&installation.id); state.loaded.remove(&installation.id);
            continue;
        }
        let status = activate(&app, &account, &profile, installation).await.unwrap_or_else(|error| InstalledState { new_tab: None, id:installation.id.clone(),status:"needs-attention".into(),version:None,detail:Some(error),review:None });
        service(&profile).lock().await.states.insert(installation.id.clone(), status);
    }
    if changed { sync::start(app.clone(), account.clone(), profile.clone()); }
    let states: Vec<InstalledState> = service(&profile).lock().await.states.values().cloned().collect();
    super::records::reconciled(profile.clone(), installations.clone(), states.clone());
    Ok(states)

    }.await;
    result.map_err(ExtensionFailure::from)
}
