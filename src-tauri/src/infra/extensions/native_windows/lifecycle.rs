//! Loading, stopping and removing extensions, and reconciling each open profile to them.
use super::*;

pub(super) async fn load(host: &mut Host, request: &Value) -> Result<Value, String> {
    let app = app()?;
    let id = request["id"].as_str().ok_or("Invalid extension ID.")?;
    let origin = request["origin"]
        .as_str()
        .ok_or("Invalid extension origin.")?;
    let runtime = PathBuf::from(request["runtimePath"].as_str().unwrap_or_default());
    let granted = granted_manifest(
        &read_manifest(&runtime)?,
        origin,
        &strings(&request["permissions"]),
        &strings(&request["hosts"]),
    );
    let _ = app;
    let root = extension_root(host, id)?;
    let folder = stage(&root, &runtime, &granted)?;
    let crx = page_host(origin).unwrap_or_default();
    let removed = removal(&host.space, &crx);
    update_ledger(|ledger| {
        ledger.removed.remove(&removed);
        ledger.managed.insert(crx);
    });
    host.loaded.insert(
        id.to_owned(),
        Loaded {
            origin: origin.to_owned(),
            folder: folder.clone(),
            private_access: request["privateAccess"] == true,
            manifest: granted,
        },
    );
    let errors = reconcile_open(host).await;
    prune(&root, &folder);
    emit(host, "changed", json!({"id": id}));
    Ok(json!({"loaded": true, "errors": errors}))
}

/// Stops the extension in every open profile, keeping its data.
pub(super) async fn unload(host: &mut Host, id: &str) -> Option<String> {
    let loaded = host.loaded.remove(id)?;
    let crx = page_host(&loaded.origin)?;
    for applied in host.applied.values_mut() {
        applied.remove(&crx);
    }
    for view in browser_views(&host.space) {
        let _ = set_enabled(&view, crx.clone(), false).await;
    }
    Some(crx)
}

/// Uninstalls the extension, with its data, from every profile.
pub(super) async fn remove_extension(host: &mut Host, id: &str) {
    let crx = match unload(host, id).await {
        Some(crx) => crx,
        None => match extension_root(host, id) {
            // Not running: its ID is in any staged manifest.
            Ok(root) => match staged_crx(&root) {
                Some(crx) => crx,
                None => return,
            },
            Err(_) => return,
        },
    };
    for view in browser_views(&host.space) {
        let _ = remove(&view, crx.clone()).await;
    }
    let removed = removal(&host.space, &crx);
    update_ledger(|ledger| {
        ledger.removed.insert(removed);
    });
    if let Ok(root) = extension_root(host, id) {
        let _ = std::fs::remove_dir_all(root);
    }
}

pub(super) async fn unload_all(host: &mut Host) {
    let ids: Vec<String> = host.loaded.keys().cloned().collect();
    for id in ids {
        unload(host, &id).await;
    }
    host.applied.clear();
    host.private_tabs.clear();
}

/// The open browser views of one Space.
fn browser_views(space: &str) -> Vec<Webview> {
    let Ok(app) = app() else {
        return Vec::new();
    };
    app.webviews()
        .into_iter()
        .filter(|(label, _)| {
            label.starts_with("misty-browser-") && !label.starts_with("misty-browser-capture-")
        })
        .map(|(_, view)| view)
        .filter(|view| view_space(view).as_deref() == Some(space))
        .collect()
}

async fn reconcile_open(host: &mut Host) -> Vec<String> {
    let mut errors = Vec::new();
    for view in browser_views(&host.space) {
        if let Err(error) = reconcile(host, &view).await {
            errors.push(error);
        }
    }
    errors.dedup();
    errors
}

/// Makes the view's profile run exactly the loaded extensions it may run:
/// Misty's others are disabled, or uninstalled once removed from Misty.
pub(super) async fn reconcile(host: &mut Host, view: &Webview) -> Result<(), String> {
    let profile = inspect(view).await?;
    let wanted: HashMap<String, PathBuf> = host
        .loaded
        .values()
        .filter(|loaded| !profile.private || loaded.private_access)
        .filter_map(|loaded| Some((page_host(&loaded.origin)?, loaded.folder.clone())))
        .collect();
    let ledger = ledger();
    for (crx, enabled) in &profile.installed {
        if !ledger.managed.contains(crx) {
            continue;
        }
        if ledger.removed.contains(&removal(&host.space, crx)) {
            remove(view, crx.clone()).await?;
        } else if *enabled && !wanted.contains_key(crx) {
            set_enabled(view, crx.clone(), false).await?;
        }
    }
    let applied = host.applied.entry(profile.path).or_default();
    for (crx, folder) in wanted {
        let installed = profile.installed.iter().any(|(id, on)| *id == crx && *on);
        if installed && applied.get(&crx) == Some(&folder) {
            continue;
        }
        add(view, folder.clone()).await?;
        applied.insert(crx, folder);
    }
    Ok(())
}
