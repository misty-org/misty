//! Changing, listing and resetting the saved choices from Settings.
use super::*;

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
                let first = letters
                    .next()
                    .map(|c| c.to_lowercase().to_string())
                    .unwrap_or_default();
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
    let before = inspect(
        &app,
        target(&app, &id)?,
        Some(canonical_origin(&origin)?),
        None,
    )
    .await?;
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

/// The stores of Spaces with an open tab, with each Space's name. Dormant stores of
/// another signed-in account stay hidden.
fn active_profiles(app: &AppHandle) -> std::collections::HashMap<String, String> {
    let spaces = crate::infra::space_windows::listed_spaces();
    app.webviews()
        .into_iter()
        .filter_map(|(label, view)| {
            let StoreScope::Persistent(profile) = session_scope(app, &label)? else {
                return None;
            };
            let key = crate::infra::space_windows::space_for_owner(view.window().label())?;
            let name = spaces
                .iter()
                .find(|space| space.key == key)
                .map(|space| space.name.clone())
                .unwrap_or_else(|| "Space".into());
            Some((profile, name))
        })
        .collect()
}

#[tauri::command]
pub async fn browser_site_permissions_list(
    caller: Webview,
    app: AppHandle,
) -> Result<Vec<ListedPermission>, String> {
    require_host(&caller)?;
    let active = active_profiles(&app);
    Ok(read_store()
        .into_iter()
        .filter_map(|(profile, sites)| Some((active.get(&profile)?.clone(), profile, sites)))
        .flat_map(|(space, profile, sites)| {
            sites
                .into_iter()
                .map(move |(origin, permissions)| ListedPermission {
                    saved: SavedPermission {
                        profile: profile.clone(),
                        origin,
                        permissions,
                    },
                    space: space.clone(),
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
    if !active_profiles(&app).contains_key(&profile) {
        return Err("Open a tab in this Space before resetting its permissions.".into());
    }
    // Serialize all store read/modify/write operations on the main thread.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let affected_profile = profile.clone();
    let reset_origin = origin.clone();
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
    space::publish(
        affected_profile.clone(),
        [(reset_origin, Permissions::default())].into(),
    );
    stop_capture(&app, &StoreScope::Persistent(affected_profile), true, true).await
}
