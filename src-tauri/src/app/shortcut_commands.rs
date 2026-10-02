use tauri::{AppHandle, Emitter, State};

use crate::app::runtime::MistyRuntime;
use crate::error::{ApiError, ApiResult};
use crate::infra::commands::{ShortcutOverride, ShortcutsSnapshot};

#[tauri::command]
pub async fn shortcuts_snapshot(
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    let snapshot = state.commands.snapshot().await?;
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
    crate::infra::app_menu::refresh(&app, &snapshot)
        .map_err(|err| ApiError::Message(format!("Failed to refresh app menu: {err}")))?;
    Ok(())
}

#[tauri::command]
pub async fn shortcuts_replace(
    overrides: Vec<ShortcutOverride>,
    state: State<'_, MistyRuntime>,
    app: AppHandle,
) -> ApiResult<ShortcutsSnapshot> {
    publish(app, state.commands.replace(overrides).await?)
}
