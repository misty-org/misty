//! What the app windows ask of agents on this computer.
use tauri::State;

use crate::agents::PrepareScopedAgentDocumentRequest;
use crate::app::error::ApiResult;
use crate::app::runtime::MistyRuntime;
use documents::PreparedAgentDocument;

#[tauri::command]
pub async fn agents_device_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    state.agents.device_snapshot().await
}

#[tauri::command]
pub async fn agents_list_scoped_files(
    webview: tauri::Webview,
    request: crate::agents::ListScopedFilesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err(crate::app::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    state.agents.list_scoped_files(request).await
}

/// The document is parsed in the bundled worker, confined by the operating
/// system; the shared folder's file is copied in, never opened in place.
#[tauri::command]
pub async fn agents_prepare_scoped_document(
    webview: tauri::Webview,
    request: PrepareScopedAgentDocumentRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedAgentDocument> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err(crate::app::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    let target = state.agents.scoped_document_path(request).await?;
    documents::prepare_document(target, crate::app::embedded_workers::builtin_worker)
        .await
        .map_err(crate::app::error::ApiError::Message)
}

/// Tutor's file sources: the person picks files in the system dialog, and each is parsed in the
/// confined document worker. The window never names a path, so it can read only what was picked.
/// A file that can't be read is left out; nothing picked is an empty list.
#[tauri::command]
pub async fn tutor_pick_sources(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> ApiResult<Vec<PreparedAgentDocument>> {
    use tauri_plugin_dialog::DialogExt;
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err(crate::app::error::ApiError::Message(
            "Only Misty's own windows can add sources.".into(),
        ));
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Add sources")
        .add_filter(
            "Documents",
            &[
                "pdf", "docx", "pptx", "xlsx", "txt", "md", "markdown", "csv", "json", "html",
            ],
        )
        .pick_files(move |files| {
            let _ = send.send(files);
        });
    let Some(files) = receive.await.ok().flatten() else {
        return Ok(Vec::new());
    };
    let mut prepared = Vec::new();
    for file in files.into_iter().take(20) {
        let Ok(path) = file.into_path() else { continue };
        let too_big = std::fs::metadata(&path)
            .map(|meta| meta.len() > documents::MAX_AGENT_DOCUMENT_BYTES)
            .unwrap_or(true);
        if too_big {
            continue;
        }
        if let Ok(document) =
            documents::prepare_document(path, crate::app::embedded_workers::builtin_worker).await
        {
            prepared.push(document);
        }
    }
    Ok(prepared)
}

// Commands that live in the feature's other modules, named here so the command table can list them all
// from one place. `generate_handler!` needs each command's hidden macros beside it, so those are named too.
pub(crate) use crate::agents::chats::commands::{
    __cmd__agent_chats_adopt, __cmd__agent_chats_delete, __cmd__agent_chats_get,
    __cmd__agent_chats_list, __cmd__agent_chats_put, __cmd__agent_chats_swap,
    __tauri_command_name_agent_chats_adopt, __tauri_command_name_agent_chats_delete,
    __tauri_command_name_agent_chats_get, __tauri_command_name_agent_chats_list,
    __tauri_command_name_agent_chats_put, __tauri_command_name_agent_chats_swap, agent_chats_adopt,
    agent_chats_delete, agent_chats_get, agent_chats_list, agent_chats_put, agent_chats_swap,
};
pub(crate) use crate::agents::connected_apps::commands::{
    __cmd__apps_grants_list, __cmd__apps_grants_revoke, __cmd__apps_request_decide,
    __cmd__apps_request_get, __cmd__apps_request_show, __cmd__apps_tool_connected,
    __cmd__apps_tool_execute, __cmd__apps_tool_schemas, __cmd__apps_tool_search,
    __tauri_command_name_apps_grants_list, __tauri_command_name_apps_grants_revoke,
    __tauri_command_name_apps_request_decide, __tauri_command_name_apps_request_get,
    __tauri_command_name_apps_request_show, __tauri_command_name_apps_tool_connected,
    __tauri_command_name_apps_tool_execute, __tauri_command_name_apps_tool_schemas,
    __tauri_command_name_apps_tool_search, apps_grants_list, apps_grants_revoke,
    apps_request_decide, apps_request_get, apps_request_show, apps_tool_connected,
    apps_tool_execute, apps_tool_schemas, apps_tool_search,
};
pub(crate) use crate::agents::connected_apps::direct::commands::{
    __cmd__direct_apps_catalog, __cmd__direct_apps_check, __cmd__direct_apps_connect,
    __cmd__direct_apps_disconnect, __cmd__direct_apps_icon, __cmd__direct_apps_list,
    __tauri_command_name_direct_apps_catalog, __tauri_command_name_direct_apps_check,
    __tauri_command_name_direct_apps_connect, __tauri_command_name_direct_apps_disconnect,
    __tauri_command_name_direct_apps_icon, __tauri_command_name_direct_apps_list,
    direct_apps_catalog, direct_apps_check, direct_apps_connect, direct_apps_disconnect,
    direct_apps_icon, direct_apps_list,
};
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) use crate::agents::cursor::{
    __cmd__cursor_companion_bind_task, __cmd__cursor_companion_capture,
    __cmd__cursor_companion_capture_region, __cmd__cursor_companion_configure,
    __cmd__cursor_companion_interrupt, __cmd__cursor_companion_present,
    __cmd__cursor_companion_snap, __cmd__cursor_companion_snapshot,
    __cmd__cursor_companion_ask_close, __cmd__cursor_companion_trail,
    __cmd__cursor_companion_watch_clicks, __tauri_command_name_cursor_companion_ask_close,
    __tauri_command_name_cursor_companion_bind_task,
    __tauri_command_name_cursor_companion_capture,
    __tauri_command_name_cursor_companion_capture_region,
    __tauri_command_name_cursor_companion_configure,
    __tauri_command_name_cursor_companion_interrupt, __tauri_command_name_cursor_companion_present,
    __tauri_command_name_cursor_companion_snap, __tauri_command_name_cursor_companion_snapshot,
    __tauri_command_name_cursor_companion_trail,
    __tauri_command_name_cursor_companion_watch_clicks, cursor_companion_bind_task,
    cursor_companion_capture, cursor_companion_capture_region, cursor_companion_configure,
    cursor_companion_interrupt, cursor_companion_present, cursor_companion_snap,
    cursor_companion_ask_close, cursor_companion_snapshot, cursor_companion_trail,
    cursor_companion_watch_clicks,
};
#[cfg(windows)]
pub(crate) use crate::agents::desktop_control::windows::overlays::{
    __cmd__agent_desktop_island_press, __cmd__agent_desktop_overlay_state,
    __tauri_command_name_agent_desktop_island_press,
    __tauri_command_name_agent_desktop_overlay_state, agent_desktop_island_press,
    agent_desktop_overlay_state,
};
#[cfg(desktop)]
pub(crate) use crate::agents::keep_awake::{
    __cmd__power_keep_awake, __tauri_command_name_power_keep_awake, power_keep_awake,
};
pub(crate) use crate::agents::live_pages_memory::{
    __cmd__system_memory_pressure, __tauri_command_name_system_memory_pressure,
    system_memory_pressure,
};
pub(crate) use crate::agents::run_control::calls::{
    __cmd__tutor_overview_audio, __cmd__tutor_overview_delete, __cmd__tutor_overview_make,
    __cmd__tutor_transcribe_sources, __tauri_command_name_tutor_overview_audio,
    __tauri_command_name_tutor_overview_delete, __tauri_command_name_tutor_overview_make,
    __tauri_command_name_tutor_transcribe_sources, tutor_overview_audio, tutor_overview_delete,
    tutor_overview_make, tutor_transcribe_sources,
};
pub(crate) use crate::agents::run_control::host_lookup::{
    __cmd__agent_host_missing, __tauri_command_name_agent_host_missing, agent_host_missing,
};
pub(crate) use crate::agents::run_control::local_runs::{
    __cmd__agent_run_cancel, __cmd__agent_run_contexts, __cmd__agent_run_end_proposal,
    __cmd__agent_run_follow, __cmd__agent_run_pause, __cmd__agent_run_publish,
    __cmd__agent_run_receipts, __cmd__agent_run_start, __cmd__agent_run_steer,
    __tauri_command_name_agent_run_cancel, __tauri_command_name_agent_run_contexts,
    __tauri_command_name_agent_run_end_proposal, __tauri_command_name_agent_run_follow,
    __tauri_command_name_agent_run_pause, __tauri_command_name_agent_run_publish,
    __tauri_command_name_agent_run_receipts, __tauri_command_name_agent_run_start,
    __tauri_command_name_agent_run_steer, agent_run_cancel, agent_run_contexts,
    agent_run_end_proposal, agent_run_follow, agent_run_pause, agent_run_publish,
    agent_run_receipts, agent_run_start, agent_run_steer,
};
pub(crate) use crate::agents::run_control::local_tools::{
    __cmd__agent_tool_finish, __cmd__agent_tool_host_ready, __tauri_command_name_agent_tool_finish,
    __tauri_command_name_agent_tool_host_ready, agent_tool_finish, agent_tool_host_ready,
};
pub(crate) use crate::agents::run_control::run_ledger::{
    __cmd__agent_run_timeline, __tauri_command_name_agent_run_timeline, agent_run_timeline,
};
pub(crate) use crate::agents::run_control::run_notices::{
    __cmd__agent_run_notify, __tauri_command_name_agent_run_notify, agent_run_notify,
};
pub(crate) use crate::agents::run_control::run_steps::{
    __cmd__agent_run_latest_steps, __cmd__agent_run_steps, __cmd__agent_run_steps_clear,
    __tauri_command_name_agent_run_latest_steps, __tauri_command_name_agent_run_steps,
    __tauri_command_name_agent_run_steps_clear, agent_run_latest_steps, agent_run_steps,
    agent_run_steps_clear,
};
pub(crate) use crate::agents::run_control::step_pictures::{
    __cmd__agent_run_step_picture, __tauri_command_name_agent_run_step_picture,
    agent_run_step_picture,
};
pub(crate) use crate::agents::run_control::tool_gate::{
    __cmd__agent_program_opens, __tauri_command_name_agent_program_opens, agent_program_opens,
};
pub(crate) use crate::agents::run_control::turn_rewind::{
    __cmd__agent_turn_files, __cmd__agent_turn_restore, __tauri_command_name_agent_turn_files,
    __tauri_command_name_agent_turn_restore, agent_turn_files, agent_turn_restore,
};
pub(crate) use crate::agents::run_control::windows::{
    __cmd__agent_window_account, __tauri_command_name_agent_window_account, agent_window_account,
};
pub(crate) use crate::agents::screen_context::{
    __cmd__misty_screen_capture, __cmd__misty_screen_status, __cmd__misty_workspace_focused,
    __tauri_command_name_misty_screen_capture, __tauri_command_name_misty_screen_status,
    __tauri_command_name_misty_workspace_focused, misty_screen_capture, misty_screen_status,
    misty_workspace_focused,
};
pub(crate) use crate::agents::shared_folders::commands::{
    __cmd__agents_adopt_folder_changes, __cmd__agents_allow_folder_changes,
    __cmd__agents_forget_folder, __cmd__agents_share_folder, __cmd__agents_stop_folder_changes,
    __tauri_command_name_agents_adopt_folder_changes,
    __tauri_command_name_agents_allow_folder_changes, __tauri_command_name_agents_forget_folder,
    __tauri_command_name_agents_share_folder, __tauri_command_name_agents_stop_folder_changes,
    agents_adopt_folder_changes, agents_allow_folder_changes, agents_forget_folder,
    agents_share_folder, agents_stop_folder_changes,
};
#[cfg(desktop)]
pub(crate) use crate::agents::shell::commands::{
    __cmd__agents_forget_workspace, __cmd__device_shell_cancel, __cmd__device_shell_job,
    __tauri_command_name_agents_forget_workspace, __tauri_command_name_device_shell_cancel,
    __tauri_command_name_device_shell_job, agents_forget_workspace, device_shell_cancel,
    device_shell_job,
};
pub(crate) use crate::agents::task_scopes::{
    __cmd__agent_foreground_queue, __cmd__agent_workspace_acquire,
    __cmd__agent_workspace_bind_scope, __cmd__agent_workspace_release,
    __tauri_command_name_agent_foreground_queue, __tauri_command_name_agent_workspace_acquire,
    __tauri_command_name_agent_workspace_bind_scope, __tauri_command_name_agent_workspace_release,
    agent_foreground_queue, agent_workspace_acquire, agent_workspace_bind_scope,
    agent_workspace_release,
};
pub(crate) use crate::agents::window_control::{
    __cmd__agent_control_island, __cmd__agent_control_yield, __cmd__agent_workspace_context,
    __tauri_command_name_agent_control_island, __tauri_command_name_agent_control_yield,
    __tauri_command_name_agent_workspace_context, agent_control_island, agent_control_yield,
    agent_workspace_context,
};
