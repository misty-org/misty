//! The renderer's view of its window and of the profiles: who the window is, opening and
//! closing windows, and changing the profiles themselves.
use super::*;

/// What a window knows about itself when its app starts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileWindowInfo {
    label: String,
    window_id: String,
    profile: ProfileEntry,
    space: Option<String>,
}

#[tauri::command]
pub fn profile_window_info(webview: tauri::Webview) -> Result<ProfileWindowInfo, String> {
    let label = webview.window().label().to_owned();
    let window = parse(&label).ok_or("This window doesn't belong to a profile.")?;
    let state = window_state(&label).ok_or("This window doesn't belong to a profile.")?;
    let profile = entry(&window.profile).ok_or("Profiles are unavailable.")?;
    Ok(ProfileWindowInfo {
        label,
        window_id: state.window_id,
        profile,
        space: state.space,
    })
}

#[tauri::command]
pub fn profiles_list(webview: tauri::Webview) -> Result<Vec<ProfileEntry>, String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can list profiles.".into());
    }
    Ok(listed_profiles())
}

/// Adds a profile and opens its first window.
#[tauri::command]
pub fn profile_create(
    webview: tauri::Webview,
    app: AppHandle,
    name: String,
    color: Option<String>,
) -> Result<ProfileEntry, String> {
    if !is_person_window(webview.label()) {
        return Err("Only a Misty window can add a profile.".into());
    }
    create_profile(&app, &name, color.as_deref())
}

#[tauri::command]
pub fn profile_rename(
    webview: tauri::Webview,
    app: AppHandle,
    id: String,
    name: String,
) -> Result<ProfileEntry, String> {
    if !is_person_window(webview.label()) {
        return Err("Only a Misty window can rename a profile.".into());
    }
    rename_profile(&app, &id, &name)
}

#[tauri::command]
pub fn profile_set_color(
    webview: tauri::Webview,
    app: AppHandle,
    id: String,
    color: String,
) -> Result<ProfileEntry, String> {
    if !is_person_window(webview.label()) {
        return Err("Only a Misty window can change a profile's color.".into());
    }
    set_color(&app, &id, &color)
}

/// Deletes a profile and everything it keeps on this computer.
#[tauri::command]
pub fn profile_delete(webview: tauri::Webview, app: AppHandle, id: String) -> Result<(), String> {
    if !is_person_window(webview.label()) {
        return Err("Only a Misty window can delete a profile.".into());
    }
    delete_profile(&app, &id)
}

/// The sites a profile claims for links from other apps.
#[tauri::command]
pub fn profile_sites(webview: tauri::Webview, id: String) -> Result<Vec<String>, String> {
    if !is_person_window(webview.label()) {
        return Err("Only a Misty window can read a profile's sites.".into());
    }
    Ok(entry(&id).ok_or("Unknown profile.")?.sites)
}

/// Saves the sites a profile claims. Returns them as stored.
#[tauri::command]
pub fn profile_set_sites(
    webview: tauri::Webview,
    app: AppHandle,
    id: String,
    sites: Vec<String>,
) -> Result<Vec<String>, String> {
    if !is_person_window(webview.label()) {
        return Err("Only a Misty window can change a profile's sites.".into());
    }
    if sites.len() > 1000 {
        return Err("That's too many sites for one profile.".into());
    }
    let hosts = normalize_sites(&sites);
    let saved = update_profile(&app, &id, |entry| {
        entry.sites = hosts;
        Ok(())
    })?;
    Ok(saved.sites)
}

/// Brings a profile's window forward, opening one if none is open.
#[tauri::command]
pub fn profile_open(webview: tauri::Webview, app: AppHandle, id: String) -> Result<(), String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can open a profile.".into());
    }
    open_profile(&app, &id)
}

/// Opens another window of the calling window's profile.
#[tauri::command]
pub fn profile_window_new(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    let key = profile_for_window(webview.label()).ok_or("This window has no profile.")?;
    open_profile_window(&app, &key)
}

/// Closes the calling window. Its tabs stay in the profile.
#[tauri::command]
pub fn profile_window_close(webview: tauri::Webview) -> Result<(), String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can close itself.".into());
    }
    webview.window().close().map_err(|error| error.to_string())
}

/// Windows of this profile that closed and left their saved tabs for this window to take.
#[tauri::command]
pub fn profile_window_take_orphans(webview: tauri::Webview) -> Vec<String> {
    take_orphans(webview.label())
}

/// Remembers which Space this window shows, for the next launch.
#[tauri::command]
pub fn profile_window_set_space(webview: tauri::Webview, space: Option<String>) {
    if space.as_deref().is_none_or(valid_key) {
        set_window_space(webview.label(), space);
    }
}

/// Whether the calling window runs this computer's own background work.
#[tauri::command]
pub fn profile_window_is_host(webview: tauri::Webview) -> bool {
    host_window().as_deref() == Some(webview.label())
}

/// Whether this window opens Misty's own links (`misty://`): the last focused app window. Web
/// links are routed natively instead (see `links`).
#[tauri::command]
pub fn profile_window_link_target(webview: tauri::Webview, app: AppHandle) -> bool {
    is_person_window(webview.label()) && primary_label(&app).as_deref() == Some(webview.label())
}
