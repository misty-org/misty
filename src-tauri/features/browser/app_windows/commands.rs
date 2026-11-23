use super::*;

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
pub fn profile_window_new(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    let key = profile_for_window(webview.label()).ok_or("This window has no profile.")?;
    open_profile_window(&app, &key)
}

#[tauri::command]
pub fn profile_window_close(webview: tauri::Webview) -> Result<(), String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can close itself.".into());
    }
    webview.window().close().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn profile_window_take_orphans(webview: tauri::Webview) -> Vec<String> {
    take_orphans(webview.label())
}

#[tauri::command]
pub fn profile_window_set_space(webview: tauri::Webview, space: Option<String>) {
    if space.as_deref().is_none_or(valid_key) {
        set_window_space(webview.label(), space);
    }
}

#[tauri::command]
pub fn profile_window_is_host(webview: tauri::Webview) -> bool {
    host_window().as_deref() == Some(webview.label())
}

#[tauri::command]
pub fn profile_window_link_target(webview: tauri::Webview, app: AppHandle) -> bool {
    is_person_window(webview.label()) && primary_label(&app).as_deref() == Some(webview.label())
}
