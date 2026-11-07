//! Re-publishes this session's policy when shared folders change.
#![cfg(desktop)]

use tauri::State;

use crate::app::device_commands::{context, shared_folders};
use crate::app::runtime::MistyRuntime;
use crate::infra::{devices::admission, devices::trust};

/// Re-publishes the policy after shared folders change, keeping its settings.
#[tauri::command]
pub async fn devices_publish_folders(
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    let context = context(&state, &api_base, &account_id).await?;
    let current = trust::effective_policy();
    let folders = shared_folders(&state).await;
    if trust::own_policy().is_some_and(|(policy, _)| policy.shared_folders == folders) {
        return Ok(());
    }
    admission::publish_policy(
        &context,
        &current.files,
        current.clipboard,
        current.agent_surfaces,
        folders,
    )
    .await?;
    Ok(())
}
