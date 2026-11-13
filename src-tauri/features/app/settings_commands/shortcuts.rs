use tauri::{AppHandle, Emitter, State};

use crate::app::error::ApiResult;
use crate::app::runtime::MistyRuntime;
use settings::shortcuts::{ShortcutOverride, ShortcutsSnapshot};

#[tauri::command]
pub async fn shortcuts_snapshot(
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    let snapshot = state.shortcuts.snapshot().await?;
    refresh_native_menu(&app, &snapshot)?;
    Ok(snapshot)
}

fn publish(app: AppHandle, snapshot: ShortcutsSnapshot) -> ApiResult<ShortcutsSnapshot> {
    refresh_native_menu(&app, &snapshot)?;
    let _ = app.emit("misty://shortcuts-changed", &snapshot);
    Ok(snapshot)
}

fn refresh_native_menu(app: &AppHandle, snapshot: &ShortcutsSnapshot) -> ApiResult<()> {
    #[cfg(target_os = "macos")]
    crate::app::app_menu::refresh(app, snapshot).map_err(|err| {
        crate::app::error::ApiError::Message(format!("Failed to refresh app menu: {err}"))
    })?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, snapshot);
    Ok(())
}

#[tauri::command]
pub async fn shortcuts_replace(
    overrides: Vec<ShortcutOverride>,
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    publish(app, state.shortcuts.replace(overrides).await?)
}
