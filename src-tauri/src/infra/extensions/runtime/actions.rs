//! An extension's toolbar action, its answers to the page, and new tabs it hears about.
use super::*;

#[tauri::command]
pub async fn extensions_action(
    caller: tauri::Webview,
    operation: String,
    id: Option<String>,
    tab_id: Option<String>,
    anchor: Option<Value>,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_, String> = async {
        let profile = native::caller_profile(&caller)?;
        if !["actions", "invoke", "options", "diagnostics"].contains(&operation.as_str()) {
            return Err("Invalid extension action.".into());
        }
        let account = service(&profile).lock().await.account.clone();
        if id
            .as_ref()
            .is_some_and(|id| catalog::Store::of(id).is_none())
        {
            return Err("Invalid extension ID.".into());
        }
        native::request(
            json!({"operation":operation,"account":account,"space":profile,"id":id,"tabId":tab_id,"anchor":anchor}),
        )
        .await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

#[tauri::command]
pub async fn extensions_respond(
    caller: tauri::Webview,
    request_id: String,
    allowed: bool,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_,String> = async {
    let profile = native::caller_profile(&caller)?;
    let account = service(&profile).lock().await.account.clone();
    // An extension's own request: what it asked for comes from the host, and the person's yes
    // becomes part of what's approved here, before WebKit hears it.
    if let Some((guid, permissions, hosts)) = approvals::take_request(&request_id).filter(|_| allowed) {
        let extension = service(&profile).lock().await.desired.values().find(|item| item.guid == guid && item.installed).map(|item| item.id.clone());
        if let Some(extension) = extension {
            approvals::approve(&sync::journal_scope(&account, &profile), &extension, &permissions, &hosts)?;
        }
    }
    native::request(json!({"operation":"permission-response","account":account,"space":profile,"requestId":request_id,"allowed":allowed})).await

    }.await;
    result.map_err(ExtensionFailure::from)
}
#[tauri::command]
pub async fn extensions_tab_created(
    caller: tauri::Webview,
    request_id: String,
    tab_id: String,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_,String> = async {
    let profile = native::caller_profile(&caller)?;
    let account = service(&profile).lock().await.account.clone();
    native::request(json!({"operation":"tab-created","account":account,"space":profile,"requestId":request_id,"tabId":tab_id})).await

    }.await;
    result.map_err(ExtensionFailure::from)
}
