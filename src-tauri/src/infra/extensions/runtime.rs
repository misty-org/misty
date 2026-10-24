//! Loading committed packages into the native extension runtime, reconciling
//! them with the account's installations, and checking for updates.
use super::install::{commit, prepare};
use super::*;

mod actions;
pub use actions::*;
mod updates;
pub use updates::*;

async fn activate(
    app: &tauri::AppHandle,
    account: &str,
    space: &str,
    installation: &Installation,
) -> Result<InstalledState, String> {
    let id = installation.id.clone();
    let package_root = root(app, account, space)?.join("packages").join(&id);
    let removed = service(space).lock().await.removed.contains(&id);
    if !installation.enabled || removed {
        native::request(json!({"operation":"unload","account":account,"space":space,"id":id}))
            .await?;
        service(space).lock().await.loaded.remove(&id);
        sync::forget(account, space, &id);
        drop_origin(space, &installation_origin(account, &installation.guid));
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
        let prepared = prepare(app, account, space, &id).await?;
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
        review = Some(commit(app, space, &prepared.token).await?);
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
    if service(space).lock().await.loaded.get(&id) != Some(&signature) {
        // Extension pages load from this host: the origin itself on macOS,
        // the extension ID derived from it on Windows.
        if let Some(host) = page_host(&origin) {
            allow_origin(space, host);
        }
        sync::forget(account, space, &id);
        // Packages installed before the compatibility layer existed gain it here.
        let _ = compat::apply(&current.join("runtime"));
        let result = native::request(json!({"operation":"load", "account":account,"space":space,"id":id,"guid":installation.guid,
            "session":ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),"runtimePath":current.join("runtime"), "origin":origin,
            "privateAccess":installation.private_access,"permissions":installation.permissions,"hosts":installation.hosts})).await;
        if let Err(error) = result {
            // The current package is retained for diagnostics; retry the prior runtime when possible.
            if let Ok(previous) = selected_package(&package_root, true) {
                if let Ok(old) = read_review(&previous) {
                    let _ = compat::apply(&previous.join("runtime"));
                    let fallback = native::request(json!({"operation":"load", "account":account,"space":space,"id":id,"guid":installation.guid,
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
        service(space)
            .lock()
            .await
            .loaded
            .insert(id.clone(), signature);
        prune_versions(&package_root);
    } else if let Some(previous) = service(space).lock().await.states.get(&id).cloned() {
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
        serde_json::from_slice(&std::fs::read(runtime.join("manifest.json")).ok()?).ok()?;
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

/// The website data store a Space's pages open in, as `browser_create` picks it:
/// the personal vault's for the personal Space, the Space's own otherwise.
#[cfg(target_os = "macos")]
async fn space_store(
    app: &tauri::AppHandle,
    space: &str,
) -> Result<(crate::infra::browser_sync::BrowserProfileLease, String), String> {
    let requested = crate::infra::space_windows::space_store_identity(space);
    let lease =
        crate::infra::browser_sync::browser_profile_lease(Some(app), requested.as_deref(), None)
            .await?;
    let identifier =
        crate::infra::browser_profile::data_store_identifier(lease.profile_id.as_deref())?;
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
    let space = native::caller_space(&caller)?;
    if account.len() > 256 || (account.is_empty() && !installations.is_empty()) || installations.len() > 256 || !installations.iter().all(valid_installation) { return Err("Invalid extension account preferences.".into()); }
    // Acquire the browser lease before the extension lifecycle lock: account
    // teardown owns the opposite end of the browser lifecycle, never SESSION here.
    #[cfg(target_os="macos")]
    let (profile, store) = space_store(&app, &space).await?;
    #[cfg(not(target_os="macos"))]
    let store = String::new();
    let _guard = lifecycle().lock().await;
    if CLOSING.load(std::sync::atomic::Ordering::Acquire) { return Err("The extension account changed.".into()); }
    native::initialize(&app);
    // Another account stops every Space; another Space of the same account starts beside the others.
    let account_changed = current_account().lock().map(|current| *current != account).unwrap_or(true);
    if account_changed {
        advance_epoch(); sync::reset();
        if let Ok(mut origins)=origins().write() { origins.clear(); }
        for other in spaces_running() { *service(&other).lock().await = ExtensionService::default(); }
        if let Ok(mut running)=running_spaces().lock() { running.clear(); }
        if let Ok(mut current)=current_account().lock() { *current = account.clone(); }
    }
    let changed = account_changed || service(&space).lock().await.account != account;
    if changed {
        if !account.is_empty() && space == crate::infra::space_windows::PERSONAL { spaces::adopt_account_packages(&app, &account)?; }
        *service(&space).lock().await = ExtensionService { account:account.clone(), ..Default::default() };
        if !account.is_empty() { if let Ok(mut running)=running_spaces().lock() { running.insert(space.clone()); } }
    }
    if account.is_empty() { return Ok(Vec::new()); }
    native::request(json!({"operation":"configure", "account":account,"space":space,"controllerId":controller_id(&account,&space),"store":store})).await?;
    #[cfg(target_os="macos")]
    drop(profile);
    let absent = { let state=service(&space).lock().await; state.desired.values().filter(|old|!installations.iter().any(|new|new.id==old.id)).cloned().collect::<Vec<_>>() };
    for old in absent {
        native::request(json!({"operation":"unload","account":account,"space":space,"id":old.id})).await?;
        sync::forget(&account,&space,&old.id);
        drop_origin(&space, &installation_origin(&account, &old.guid));
        let mut state=service(&space).lock().await; state.states.remove(&old.id); state.loaded.remove(&old.id);
    }
    { let mut state = service(&space).lock().await; state.desired = installations.iter().cloned().map(|v|(v.id.clone(),v)).collect(); state.agent_access = agent_access; }
    let reconcile_epoch=ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire);
    for installation in &installations {
        if ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire)!=reconcile_epoch { return Err("The extension account changed.".into()); }
        if !installation.installed {
            let _ = native::request(json!({"operation":"remove", "account":account,"space":space,"id":installation.id,"guid":installation.guid})).await;
            sync::queue_removal(&app,&account,&space,installation)?;
            sync::forget(&account,&space,&installation.id);
            sync::clear_local(&app,&account,&space,installation).await?;
            drop_origin(&space, &installation_origin(&account, &installation.guid));
            // Sync teardown can hold the account session lock; never await it while
            // holding the extension lifecycle lock used by account teardown.
            let removed=installation.clone(); let removed_account=account.clone(); let removed_space=space.clone();
            tauri::async_runtime::spawn(async move { sync::remove(&removed_account,&removed_space,&removed).await; });
            let package = root(&app, &account, &space)?.join("packages").join(&installation.id);
            if package.exists() { std::fs::remove_dir_all(package).map_err(|e| e.to_string())?; }
            let mut state = service(&space).lock().await; state.states.remove(&installation.id); state.loaded.remove(&installation.id);
            continue;
        }
        let status = activate(&app, &account, &space, installation).await.unwrap_or_else(|error| InstalledState { new_tab: None, id:installation.id.clone(),status:"needs-attention".into(),version:None,detail:Some(error),review:None });
        service(&space).lock().await.states.insert(installation.id.clone(), status);
    }
    if changed { sync::start(app.clone(), account.clone(), space.clone()); }
    let states: Vec<InstalledState> = service(&space).lock().await.states.values().cloned().collect();
    super::space::reconciled(crate::infra::space_windows::space_id_for_key(&space), installations.clone(), states.clone());
    Ok(states)

    }.await;
    result.map_err(ExtensionFailure::from)
}
