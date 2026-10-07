//! Loading committed packages into the native extension runtime, reconciling
//! them with the account's installations, and checking for updates.
use super::install::{commit, prepare};
use super::*;

async fn activate(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<InstalledState, String> {
    let id = installation.id;
    let package_root = root(app, account)?.join("packages").join(id.to_string());
    if !installation.enabled {
        native::request(json!({"operation":"unload","account":account,"id":id.to_string()}))
            .await?;
        service().lock().await.loaded.remove(&id);
        sync::forget(account, id);
        if let Ok(mut origins) = origins().write() {
            origins.remove(&uuid_for(&format!("{account}:{}", installation.guid)));
        }
        let review = selected_package(&package_root, false)
            .ok()
            .and_then(|path| read_review(&path).ok());
        return Ok(InstalledState {
            id,
            status: "disabled".into(),
            version: review.as_ref().map(|v| v.entry.version.clone()),
            detail: None,
            review,
        });
    }
    // Synced settings may name an extension, or access, that nobody approved
    // on this device; see approvals.rs.
    let approved = approvals::covers(app, account, installation);
    let mut review = selected_package(&package_root, false)
        .ok()
        .and_then(|path| read_review(&path).ok());
    if review.is_none() {
        let prepared = prepare(app, account, id).await?;
        if !approved
            || prepared.entry.guid != installation.guid
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
                id,
                status: "needs-review".into(),
                version: None,
                detail: Some("Review this version's permissions before installing it here.".into()),
                review: Some(prepared),
            });
        }
        review = Some(commit(app, &prepared.token).await?);
    }
    if !approved {
        native::request(json!({"operation":"unload","account":account,"id":id.to_string()}))
            .await?;
        service().lock().await.loaded.remove(&id);
        sync::forget(account, id);
        if let Ok(mut origins) = origins().write() {
            origins.remove(&uuid_for(&format!("{account}:{}", installation.guid)));
        }
        return Ok(InstalledState {
            id,
            status: "needs-review".into(),
            version: review.as_ref().map(|value| value.entry.version.clone()),
            detail: Some("Review this extension's access before it runs on this device.".into()),
            review,
        });
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
    if service().lock().await.loaded.get(&id) != Some(&signature) {
        if let Ok(mut origins) = origins().write() {
            origins.insert(uuid_for(&format!("{account}:{}", installation.guid)));
        }
        sync::forget(account, id);
        // Packages installed before the compatibility layer existed gain it here.
        let _ = compat::apply(&current.join("runtime"));
        let result = native::request(json!({"operation":"load", "account":account,"id":id.to_string(),"guid":installation.guid,
            "session":ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),"runtimePath":current.join("runtime"), "origin":uuid_for(&format!("{account}:{}",installation.guid)),
            "privateAccess":installation.private_access,"permissions":installation.permissions,"hosts":installation.hosts})).await;
        if let Err(error) = result {
            // The current package is retained for diagnostics; retry the prior runtime when possible.
            if let Ok(previous) = selected_package(&package_root, true) {
                if let Ok(old) = read_review(&previous) {
                    let _ = compat::apply(&previous.join("runtime"));
                    let fallback = native::request(json!({"operation":"load", "account":account,"id":id.to_string(),"guid":installation.guid,
                    "session":ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),"runtimePath":previous.join("runtime"),"origin":uuid_for(&format!("{account}:{}",installation.guid)),
                    "privateAccess":installation.private_access,"permissions":installation.permissions,"hosts":installation.hosts})).await;
                    fallback.map_err(|failure| {
                        format!("The update and previous runtime both failed: {error}; {failure}")
                    })?;
                    return Ok(InstalledState {
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
        service().lock().await.loaded.insert(id, signature);
        prune_versions(&package_root);
    } else if let Some(previous) = service().lock().await.states.get(&id).cloned() {
        if matches!(previous.status.as_str(), "needs-attention" | "needs-review") {
            return Ok(previous);
        }
    }
    Ok(InstalledState {
        id,
        status: "enabled".into(),
        version: Some(review.entry.version.clone()),
        detail: None,
        review: Some(review),
    })
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
    native::trusted(&caller)?;
    if account.len() > 256 || (account.is_empty() && !installations.is_empty()) || installations.len() > 256 || !installations.iter().all(valid_installation) { return Err("Invalid extension account preferences.".into()); }
    // Acquire the browser lease before the extension lifecycle lock: account
    // teardown owns the opposite end of the browser lifecycle, never SESSION here.
    #[cfg(target_os="macos")]
    let profile=crate::infra::browser_sync::browser_profile_lease(Some(&app),None,None).await?;
    let _guard = lifecycle().lock().await;
    if CLOSING.load(std::sync::atomic::Ordering::Acquire) { return Err("The extension account changed.".into()); }
    native::initialize(&app);
    let changed = service().lock().await.account != account;
    if changed { advance_epoch(); sync::reset(); if let Ok(mut origins)=origins().write() { origins.clear(); } *service().lock().await = ExtensionService { account:account.clone(), ..Default::default() }; }
    native::request(json!({"operation":"configure", "account":account,"controllerId":uuid_for(&account)})).await?;
    #[cfg(target_os="macos")]
    if !account.is_empty() {
        let identifier=crate::infra::browser_profile::data_store_identifier(profile.profile_id.as_deref())?;
        if let Some(pointer)=native::configuration(&app,identifier,false,"about:blank".into(),true).await? {
            // No webview is allocated while priming the account controller.
            let _=app.run_on_main_thread(move || unsafe { drop(objc2::rc::Retained::from_raw(pointer as *mut objc2_web_kit::WKWebViewConfiguration)); });
        }
    }
    #[cfg(target_os="macos")]
    drop(profile);
    if !account.is_empty() { approvals::seed_existing(&app, &account, &installations)?; }
    let absent = { let state=service().lock().await; state.desired.values().filter(|old|!installations.iter().any(|new|new.id==old.id)).cloned().collect::<Vec<_>>() };
    for old in absent {
        native::request(json!({"operation":"unload","account":account,"id":old.id.to_string()})).await?;
        sync::forget(&account,old.id);
        if let Ok(mut origins)=origins().write() { origins.remove(&uuid_for(&format!("{account}:{}",old.guid))); }
        let mut state=service().lock().await; state.states.remove(&old.id); state.loaded.remove(&old.id);
    }
    { let mut state = service().lock().await; state.desired = installations.iter().cloned().map(|v|(v.id,v)).collect(); state.agent_access = agent_access; }
    let reconcile_epoch=ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire);
    for installation in &installations {
        if ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire)!=reconcile_epoch { return Err("The extension account changed.".into()); }
        if !installation.installed {
            let _ = native::request(json!({"operation":"remove", "account":account,"id":installation.id.to_string(),"guid":installation.guid})).await;
            sync::queue_removal(&app,&account,installation)?;
            sync::forget(&account,installation.id);
            sync::clear_local(&app,&account,installation).await?;
            if let Ok(mut origins)=origins().write() { origins.remove(&uuid_for(&format!("{account}:{}",installation.guid))); }
            // Sync teardown can hold the account session lock; never await it while
            // holding the extension lifecycle lock used by account teardown.
            let removed=installation.clone(); let removed_account=account.clone();
            tauri::async_runtime::spawn(async move { sync::remove(&removed_account,&removed).await; });
            let package = root(&app, &account)?.join("packages").join(installation.id.to_string());
            if package.exists() { std::fs::remove_dir_all(package).map_err(|e| e.to_string())?; }
            let mut state = service().lock().await; state.states.remove(&installation.id); state.loaded.remove(&installation.id);
            continue;
        }
        let status = activate(&app, &account, installation).await.unwrap_or_else(|error| InstalledState { id:installation.id,status:"needs-attention".into(),version:None,detail:Some(error),review:None });
        service().lock().await.states.insert(installation.id, status);
    }
    if changed && !account.is_empty() { sync::start(app.clone(), account.clone()); }
    Ok(service().lock().await.states.values().cloned().collect())

    }.await;
    result.map_err(ExtensionFailure::from)
}

#[tauri::command]
pub async fn extensions_action(
    caller: tauri::Webview,
    operation: String,
    id: Option<u64>,
    tab_id: Option<String>,
    anchor: Option<Value>,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_,String> = async {
    native::trusted(&caller)?;
    if !["actions", "invoke", "options", "diagnostics"].contains(&operation.as_str()) { return Err("Invalid extension action.".into()); }
    let account = service().lock().await.account.clone();
    native::request(json!({"operation":operation,"account":account,"id":id.map(|v|v.to_string()),"tabId":tab_id,"anchor":anchor})).await

    }.await;
    result.map_err(ExtensionFailure::from)
}

#[tauri::command]
pub async fn extensions_respond(
    caller: tauri::Webview,
    request_id: String,
    allowed: bool,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_,String> = async {
    native::trusted(&caller)?;
    let account = service().lock().await.account.clone();
    native::request(json!({"operation":"permission-response","account":account,"requestId":request_id,"allowed":allowed})).await

    }.await;
    result.map_err(ExtensionFailure::from)
}
#[tauri::command]
pub async fn extensions_tab_created(
    caller: tauri::Webview,
    request_id: String,
    tab_id: String,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_,String> = async {
    native::trusted(&caller)?;
    let account = service().lock().await.account.clone();
    native::request(json!({"operation":"tab-created","account":account,"requestId":request_id,"tabId":tab_id})).await

    }.await;
    result.map_err(ExtensionFailure::from)
}

#[tauri::command]
pub async fn extensions_check_updates(
    caller: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Vec<InstalledState>, ExtensionFailure> {
    let result: Result<_, String> = async {
        native::trusted(&caller)?;
        let _guard = lifecycle().lock().await;
        let (account, installations) = {
            let state = service().lock().await;
            (
                state.account.clone(),
                state
                    .desired
                    .values()
                    .filter(|v| v.installed)
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        };
        for installation in installations {
            let result = async {
                let latest = cancellable(
                    ACCOUNT_EPOCH.load(std::sync::atomic::Ordering::Acquire),
                    catalog::detail(installation.id),
                )
                .await?;
                let current = read_review(&selected_package(
                    &root(&app, &account)?
                        .join("packages")
                        .join(installation.id.to_string()),
                    false,
                )?)?;
                if current.entry.digest == latest.digest {
                    return Ok::<_, String>(None);
                }
                let review = prepare(&app, &account, installation.id).await?;
                if review.blocked
                    || review
                        .permissions
                        .iter()
                        .any(|p| !installation.permissions.contains(p))
                    || review.hosts.iter().any(|p| !installation.hosts.contains(p))
                {
                    return Ok(Some(InstalledState {
                        id: installation.id,
                        status: "needs-review".into(),
                        version: Some(current.entry.version),
                        detail: Some("An update needs permission review.".into()),
                        review: Some(review),
                    }));
                }
                commit(&app, &review.token).await?;
                Ok(Some(activate(&app, &account, &installation).await?))
            }
            .await;
            match result {
                Ok(Some(status)) => {
                    service()
                        .lock()
                        .await
                        .states
                        .insert(installation.id, status);
                }
                Err(error) => {
                    if let Some(status) = service().lock().await.states.get_mut(&installation.id) {
                        status.detail = Some(format!("Could not check for updates: {error}"));
                    }
                }
                _ => {}
            }
        }
        let _ = app.emit_to(
            "main",
            "misty://extensions",
            json!({"kind":"changed","account":account}),
        );
        Ok(service().lock().await.states.values().cloned().collect())
    }
    .await;
    result.map_err(ExtensionFailure::from)
}
