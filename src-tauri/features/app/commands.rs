//! The app-wide commands.
use serde::Serialize;
use tauri::State;

use crate::app::error::ApiResult;
use crate::app::runtime::MistyRuntime;
use database::environment::AppEnvironmentSnapshot;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    app_name: &'static str,
    version: &'static str,
    migration_stage: &'static str,
    environment: AppEnvironmentSnapshot,
}

#[tauri::command]
pub async fn app_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<AppSnapshot> {
    Ok(AppSnapshot {
        app_name: "Misty",
        version: env!("CARGO_PKG_VERSION"),
        migration_stage: "desktop",
        environment: state.environment.snapshot(),
    })
}
