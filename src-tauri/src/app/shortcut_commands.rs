use tauri::{AppHandle, Emitter, State};

use crate::app::runtime::MistyRuntime;
use crate::error::{ApiError, ApiResult};
use crate::infra::commands::{
    ReassignShortcutRequest, ResetShortcutRequest, ShortcutsSnapshot, UpdateShortcutRequest,
};

#[tauri::command]
pub async fn shortcuts_snapshot(
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    let snapshot = state.commands.snapshot().await?;
    refresh_native_menu(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn shortcuts_update(
    request: UpdateShortcutRequest,
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    publish(app, state.commands.update(request).await?)
}

#[tauri::command]
pub async fn shortcuts_reassign(
    request: ReassignShortcutRequest,
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    publish(app, state.commands.reassign(request).await?)
}

#[tauri::command]
pub async fn shortcuts_reset(
    request: ResetShortcutRequest,
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    publish(app, state.commands.reset(request).await?)
}

fn publish(app: AppHandle, snapshot: ShortcutsSnapshot) -> ApiResult<ShortcutsSnapshot> {
    refresh_native_menu(&app, &snapshot)?;
    let _ = app.emit("misty://shortcuts-changed", &snapshot);
    Ok(snapshot)
}

fn refresh_native_menu(app: &AppHandle, snapshot: &ShortcutsSnapshot) -> ApiResult<()> {
    #[cfg(target_os = "macos")]
    crate::infra::app_menu::refresh(&app, &snapshot)
        .map_err(|err| ApiError::Message(format!("Failed to refresh app menu: {err}")))?;
    Ok(())
}
