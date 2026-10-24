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
        let space = native::caller_space(&caller)?;
        if !["actions", "invoke", "options", "diagnostics"].contains(&operation.as_str()) {
            return Err("Invalid extension action.".into());
        }
        let account = service(&space).lock().await.account.clone();
        if id
            .as_ref()
            .is_some_and(|id| catalog::Store::of(id).is_none())
        {
            return Err("Invalid extension ID.".into());
        }
        native::request(
            json!({"operation":operation,"account":account,"space":space,"id":id,"tabId":tab_id,"anchor":anchor}),
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
    let space = native::caller_space(&caller)?;
    let account = service(&space).lock().await.account.clone();
    native::request(json!({"operation":"permission-response","account":account,"space":space,"requestId":request_id,"allowed":allowed})).await

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
    let space = native::caller_space(&caller)?;
    let account = service(&space).lock().await.account.clone();
    native::request(json!({"operation":"tab-created","account":account,"space":space,"requestId":request_id,"tabId":tab_id})).await

    }.await;
    result.map_err(ExtensionFailure::from)
}
