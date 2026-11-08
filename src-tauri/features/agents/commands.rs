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
#[cfg(any(windows, target_os = "macos"))]
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
    __cmd__composio_apps_catalog, __cmd__composio_apps_connect, __cmd__composio_apps_disconnect,
    __cmd__composio_apps_list, __cmd__composio_grants_list, __cmd__composio_grants_revoke,
    __cmd__composio_request_decide, __cmd__composio_request_get, __cmd__composio_request_link,
    __cmd__composio_request_show, __cmd__composio_tool_connect, __cmd__composio_tool_connected,
    __cmd__composio_tool_execute, __cmd__composio_tool_schemas, __cmd__composio_tool_search,
    __tauri_command_name_composio_apps_catalog, __tauri_command_name_composio_apps_connect,
    __tauri_command_name_composio_apps_disconnect, __tauri_command_name_composio_apps_list,
    __tauri_command_name_composio_grants_list, __tauri_command_name_composio_grants_revoke,
    __tauri_command_name_composio_request_decide, __tauri_command_name_composio_request_get,
    __tauri_command_name_composio_request_link, __tauri_command_name_composio_request_show,
    __tauri_command_name_composio_tool_connect, __tauri_command_name_composio_tool_connected,
    __tauri_command_name_composio_tool_execute, __tauri_command_name_composio_tool_schemas,
    __tauri_command_name_composio_tool_search, composio_apps_catalog, composio_apps_connect,
    composio_apps_disconnect, composio_apps_list, composio_grants_list, composio_grants_revoke,
    composio_request_decide, composio_request_get, composio_request_link, composio_request_show,
    composio_tool_connect, composio_tool_connected, composio_tool_execute, composio_tool_schemas,
    composio_tool_search,
};
#[cfg(any(target_os = "macos", windows))]
pub(crate) use crate::agents::cursor::{
    __cmd__cursor_companion_bind_task, __cmd__cursor_companion_capture,
    __cmd__cursor_companion_capture_region, __cmd__cursor_companion_configure,
    __cmd__cursor_companion_interrupt, __cmd__cursor_companion_present,
    __cmd__cursor_companion_snap, __cmd__cursor_companion_snapshot,
    __cmd__cursor_companion_watch_clicks, __tauri_command_name_cursor_companion_bind_task,
    __tauri_command_name_cursor_companion_capture,
    __tauri_command_name_cursor_companion_capture_region,
    __tauri_command_name_cursor_companion_configure,
    __tauri_command_name_cursor_companion_interrupt, __tauri_command_name_cursor_companion_present,
    __tauri_command_name_cursor_companion_snap, __tauri_command_name_cursor_companion_snapshot,
    __tauri_command_name_cursor_companion_watch_clicks, cursor_companion_bind_task,
    cursor_companion_capture, cursor_companion_capture_region, cursor_companion_configure,
    cursor_companion_interrupt, cursor_companion_present, cursor_companion_snap,
    cursor_companion_snapshot, cursor_companion_watch_clicks,
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
pub(crate) use crate::agents::models::chatgpt::{
    __cmd__model_keys_chatgpt_sign_in, __cmd__model_keys_chatgpt_sign_out,
    __cmd__model_keys_chatgpt_status, __tauri_command_name_model_keys_chatgpt_sign_in,
    __tauri_command_name_model_keys_chatgpt_sign_out,
    __tauri_command_name_model_keys_chatgpt_status, model_keys_chatgpt_sign_in,
    model_keys_chatgpt_sign_out, model_keys_chatgpt_status,
};
pub(crate) use crate::agents::models::keys::{
    __cmd__model_keys_add, __cmd__model_keys_models, __cmd__model_keys_openrouter_sign_in,
    __tauri_command_name_model_keys_add, __tauri_command_name_model_keys_models,
    __tauri_command_name_model_keys_openrouter_sign_in, model_keys_add, model_keys_models,
    model_keys_openrouter_sign_in,
};
pub(crate) use crate::agents::models::{
    __cmd__model_keys_remove, __cmd__model_keys_save, __cmd__model_keys_saved,
    __tauri_command_name_model_keys_remove, __tauri_command_name_model_keys_save,
    __tauri_command_name_model_keys_saved, model_keys_remove, model_keys_save, model_keys_saved,
};
pub(crate) use crate::agents::run_control::calls::{
    __cmd__agent_runtime_call, __tauri_command_name_agent_runtime_call, agent_runtime_call,
};
pub(crate) use crate::agents::run_control::host_lookup::{
    __cmd__agent_host_missing, __tauri_command_name_agent_host_missing, agent_host_missing,
};
pub(crate) use crate::agents::run_control::live::{
    __cmd__agent_runtime_live_open, __cmd__agent_runtime_session_close,
    __cmd__agent_runtime_session_send, __cmd__agent_runtime_voice_open,
    __tauri_command_name_agent_runtime_live_open, __tauri_command_name_agent_runtime_session_close,
    __tauri_command_name_agent_runtime_session_send, __tauri_command_name_agent_runtime_voice_open,
    agent_runtime_live_open, agent_runtime_session_close, agent_runtime_session_send,
    agent_runtime_voice_open,
};
pub(crate) use crate::agents::run_control::local_runs::{
    __cmd__agent_run_cancel, __cmd__agent_run_contexts, __cmd__agent_run_end_proposal,
    __cmd__agent_run_follow, __cmd__agent_run_pause, __cmd__agent_run_publish,
    __cmd__agent_run_receipts, __cmd__agent_run_start, __cmd__agent_run_steer,
    __cmd__agent_run_tools, __tauri_command_name_agent_run_cancel,
    __tauri_command_name_agent_run_contexts, __tauri_command_name_agent_run_end_proposal,
    __tauri_command_name_agent_run_follow, __tauri_command_name_agent_run_pause,
    __tauri_command_name_agent_run_publish, __tauri_command_name_agent_run_receipts,
    __tauri_command_name_agent_run_start, __tauri_command_name_agent_run_steer,
    __tauri_command_name_agent_run_tools, agent_run_cancel, agent_run_contexts,
    agent_run_end_proposal, agent_run_follow, agent_run_pause, agent_run_publish,
    agent_run_receipts, agent_run_start, agent_run_steer, agent_run_tools,
};
pub(crate) use crate::agents::run_control::local_tools::{
    __cmd__agent_tool_finish, __cmd__agent_tool_host_ready, __tauri_command_name_agent_tool_finish,
    __tauri_command_name_agent_tool_host_ready, agent_tool_finish, agent_tool_host_ready,
};
pub(crate) use crate::agents::run_control::tool_gate::{
    __cmd__agent_program_opens, __tauri_command_name_agent_program_opens, agent_program_opens,
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
    __cmd__agent_browser_session_id, __cmd__agent_foreground_queue, __cmd__agent_workspace_acquire,
    __cmd__agent_workspace_bind_scope, __cmd__agent_workspace_release,
    __tauri_command_name_agent_browser_session_id, __tauri_command_name_agent_foreground_queue,
    __tauri_command_name_agent_workspace_acquire, __tauri_command_name_agent_workspace_bind_scope,
    __tauri_command_name_agent_workspace_release, agent_browser_session_id, agent_foreground_queue,
    agent_workspace_acquire, agent_workspace_bind_scope, agent_workspace_release,
};
pub(crate) use crate::agents::window_control::{
    __cmd__agent_control_island, __cmd__agent_control_yield, __cmd__agent_workspace_context,
    __tauri_command_name_agent_control_island, __tauri_command_name_agent_control_yield,
    __tauri_command_name_agent_workspace_context, agent_control_island, agent_control_yield,
    agent_workspace_context,
};
