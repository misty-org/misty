//! What the app windows ask of the account: the signed-in user, the session, the API cache, sign-in
//! windows and the server's address.
use crate::app::error::{ApiError, ApiResult};

#[tauri::command]
pub async fn server_host_resolves_public(webview: tauri::Webview, host: String) -> ApiResult<bool> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can check a server's address.".into(),
        ));
    }
    Ok(crate::agents::web_fetch::host_resolves_public(&host).await)
}

// Commands that live in the feature's other modules, named here so the command table can list them all
// from one place. `generate_handler!` needs each command's hidden macros beside it, so those are named too.
pub(crate) use crate::account::api_cache::{
    __cmd__api_cache_clear, __cmd__api_cache_delete_prefix, __cmd__api_cache_get,
    __cmd__api_cache_put, __tauri_command_name_api_cache_clear,
    __tauri_command_name_api_cache_delete_prefix, __tauri_command_name_api_cache_get,
    __tauri_command_name_api_cache_put, api_cache_clear, api_cache_delete_prefix, api_cache_get,
    api_cache_put,
};
#[cfg(target_os = "macos")]
pub(crate) use crate::account::google_sign_in_sheet::{
    __cmd__google_sign_in_sheet_close, __cmd__google_sign_in_sheet_open,
    __tauri_command_name_google_sign_in_sheet_close,
    __tauri_command_name_google_sign_in_sheet_open, google_sign_in_sheet_close,
    google_sign_in_sheet_open,
};
pub(crate) use crate::account::http::{
    __cmd__auth_http_cancel, __cmd__auth_http_read, __cmd__auth_http_start,
    __tauri_command_name_auth_http_cancel, __tauri_command_name_auth_http_read,
    __tauri_command_name_auth_http_start, auth_http_cancel, auth_http_read, auth_http_start,
};
pub(crate) use crate::account::session::{
    __cmd__auth_session_capture, __cmd__auth_session_forget, __cmd__auth_session_restore,
    __tauri_command_name_auth_session_capture, __tauri_command_name_auth_session_forget,
    __tauri_command_name_auth_session_restore, auth_session_capture, auth_session_forget,
    auth_session_restore,
};
pub(crate) use crate::account::signed_in_user::{
    __cmd__check_system, __cmd__save_authenticated_user, __cmd__sign_out_misty,
    __tauri_command_name_check_system, __tauri_command_name_save_authenticated_user,
    __tauri_command_name_sign_out_misty, check_system, save_authenticated_user, sign_out_misty,
};
