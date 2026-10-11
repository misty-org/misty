//! The renderer's view of its window: the Space it shows, switching it, the account's
//! Spaces, opening and closing windows, the Space color and removing a deleted Space.
use super::*;
use serde::Deserialize;

/// What a window knows about itself when its app starts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceWindowInfo {
    label: String,
    space: SpaceEntry,
    personal: bool,
    incognito: bool,
}

#[tauri::command]
pub fn space_window_info(webview: tauri::Webview) -> Result<SpaceWindowInfo, String> {
    let label = webview.window().label().to_owned();
    let window = parse(&label).ok_or("This window doesn't belong to a Space.")?;
    let space = entry(&window.space).ok_or("Spaces are unavailable.")?;
    Ok(SpaceWindowInfo {
        personal: window.space == PERSONAL,
        incognito: window.incognito,
        label,
        space,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedSpace {
    id: String,
    personal: bool,
    name: String,
}

/// The account's Spaces, as the renderer of a Space window knows them.
#[tauri::command]
pub fn space_windows_set_spaces(
    webview: tauri::Webview,
    app: AppHandle,
    spaces: Vec<ListedSpace>,
) -> Result<(), String> {
    if !is_space_window(webview.label()) || spaces.len() > 500 {
        return Err("Only a Space window can list Spaces.".into());
    }
    set_spaces(
        &app,
        spaces
            .into_iter()
            .map(|space| (space.id, space.personal, space.name))
            .collect(),
    );
    Ok(())
}

/// Switches the calling window to another Space in place.
#[tauri::command]
pub fn space_window_switch(
    webview: tauri::Webview,
    app: AppHandle,
    space_id: String,
    personal: bool,
) -> Result<SpaceEntry, String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can switch Spaces.".into());
    }
    switch_space(&app, webview.label(), &space_key(&space_id, personal)?)
}

/// Whether the calling window runs this device's own background work.
#[tauri::command]
pub fn space_window_is_host(webview: tauri::Webview) -> bool {
    host_window().as_deref() == Some(webview.label())
}

/// Opens a new window showing a Space.
#[tauri::command]
pub fn space_window_open(
    webview: tauri::Webview,
    app: AppHandle,
    space_id: String,
    personal: bool,
) -> Result<(), String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can open a Space.".into());
    }
    open_space_window(&app, &space_key(&space_id, personal)?)
}

/// Opens an incognito window in the calling window's Space.
#[tauri::command]
pub fn space_incognito_open(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    let key = space_for_window(webview.label()).ok_or("This window doesn't belong to a Space.")?;
    open_incognito(&app, &key)
}

/// Sets the calling window's Space color; every window of that Space takes it.
#[tauri::command]
pub fn space_window_set_color(
    webview: tauri::Webview,
    app: AppHandle,
    color: String,
) -> Result<SpaceEntry, String> {
    if !is_space_window(webview.label()) {
        return Err("Only a Space window can change its color.".into());
    }
    let key = space_for_window(webview.label()).ok_or("This window doesn't belong to a Space.")?;
    set_color(&app, &key, &color)
}

/// Closes the calling window. Its Space stays; reopening it brings its tabs back.
#[tauri::command]
pub fn space_window_close(webview: tauri::Webview) -> Result<(), String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can close itself.".into());
    }
    webview.window().close().map_err(|error| error.to_string())
}

/// Shows the Spaces menu (the one in the Window menu) at the pointer.
#[tauri::command]
pub fn space_windows_menu(webview: tauri::Webview, app: AppHandle) -> Result<(), String> {
    if !is_app_window(webview.label()) {
        return Err("Only a Misty window can list Spaces.".into());
    }
    #[cfg(target_os = "macos")]
    return crate::infra::app_menu::popup_spaces(&app, &webview.window());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}


/// Whether this window opens Misty's own links (`misty://`): the last focused Space
/// window. Web links are routed natively instead (see `links`).
#[tauri::command]
pub fn space_window_link_target(webview: tauri::Webview, app: AppHandle) -> bool {
    is_space_window(webview.label()) && primary_label(&app).as_deref() == Some(webview.label())
}

/// Closes a deleted or left Space's windows. Its website data is removed afterwards
/// by `browser_space_data_remove`, once the store is no longer in use.
#[tauri::command]
pub fn space_window_remove(
    webview: tauri::Webview,
    app: AppHandle,
    space_id: String,
) -> Result<(), String> {
    if !is_space_window(webview.label()) {
        return Err("Only a Space window can remove a Space.".into());
    }
    // Windows showing the Space switch to the personal Space.
    delete_space(&app, &space_key(&space_id, false)?)
}
