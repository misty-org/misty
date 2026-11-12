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

/// The stores of profiles with an open tab, with each profile's name. Dormant stores of
/// another signed-in account stay hidden.
fn active_profiles(app: &AppHandle) -> std::collections::HashMap<String, String> {
    let profiles = crate::browser::app_windows::listed_profiles();
    app.webviews()
        .into_iter()
        .filter_map(|(label, view)| {
            let StoreScope::Persistent(profile) = session_scope(app, &label)? else {
                return None;
            };
            let key = crate::browser::app_windows::profile_for_owner(view.window().label())?;
            let name = profiles
                .iter()
                .find(|profile| profile.id == key)
                .map(|profile| profile.name.clone())
                .unwrap_or_else(|| "Profile".into());
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
        .flat_map(|(profile_name, profile, sites)| {
            sites
                .into_iter()
                .map(move |(origin, permissions)| ListedPermission {
                    saved: SavedPermission {
                        profile: profile.clone(),
                        origin,
                        permissions,
                    },
                    profile_name: profile_name.clone(),
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
        return Err("Open a tab in this profile before resetting its permissions.".into());
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
    profile::publish(
        affected_profile.clone(),
        [(reset_origin, Permissions::default())].into(),
    );
    stop_capture(&app, &StoreScope::Persistent(affected_profile), true, true).await
}
