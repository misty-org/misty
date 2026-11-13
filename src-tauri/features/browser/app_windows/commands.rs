//! The renderer's view of its window: who the window is, and opening and closing windows.
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
