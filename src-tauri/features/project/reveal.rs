use super::{linked_path, person_window};

#[tauri::command]
pub async fn project_reveal_path(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    person_window(&webview)?;
    let real = linked_path(&app, &account, &path).await?;
    app.opener()
        .reveal_item_in_dir(real)
        .map_err(|error| error.to_string())
}
