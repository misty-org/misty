use crate::browser::*;
use std::sync::Mutex;
use std::time::Duration;

const FIND_SCRIPT: &str = include_str!("../../kiri_link/scripts/find.js");
const MAX_FIND_QUERY: usize = 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFindRequest {
    pub id: String,
    pub query: String,
    pub direction: String,
    #[serde(default)]
    pub match_case: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BrowserFindResult {
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserZoomRequest {
    pub id: String,
    pub factor: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavState {
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

async fn page_value(webview: &Webview, script: String) -> Result<String, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(script, move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(value);
            }
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "The page did not respond.".to_owned())?
        .map_err(|_| "The page closed before it responded.".to_owned())
}

fn running(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}

#[tauri::command]
pub async fn browser_webview_find(
    app: AppHandle,
    request: BrowserFindRequest,
) -> Result<BrowserFindResult, String> {
    let webview = running(&app, &request.id)?;
    let direction = match request.direction.as_str() {
        "next" | "previous" | "clear" => request.direction.as_str(),
        _ => return Err("Unknown find direction.".to_owned()),
    };
    let query: String = request.query.chars().take(MAX_FIND_QUERY).collect();
    let script = FIND_SCRIPT
        .replace(
            "__MISTY_FIND_QUERY__",
            &serde_json::to_string(&query).map_err(|error| error.to_string())?,
        )
        .replace(
            "__MISTY_FIND_DIRECTION__",
            &serde_json::to_string(direction).map_err(|error| error.to_string())?,
        )
        .replace(
            "__MISTY_FIND_OPTIONS__",
            &json!({
                "highlightAll": true,
                "matchCase": request.match_case,
                "matchDiacritics": false,
                "wholeWords": false,
            })
            .to_string(),
        );
    let value = page_value(&webview, script).await?;
    Ok(serde_json::from_str::<Option<BrowserFindResult>>(&value)
        .ok()
        .flatten()
        .unwrap_or_default())
}

#[tauri::command]
pub fn browser_webview_set_zoom(app: AppHandle, request: BrowserZoomRequest) -> Result<(), String> {
    if !request.factor.is_finite() || !(0.25..=5.0).contains(&request.factor) {
        return Err("Page zoom must be between 25% and 500%.".into());
    }
    running(&app, &request.id)?
        .set_zoom(request.factor)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_webview_nav_state(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<BrowserNavState, String> {
    let webview = running(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(sender));
        webview
            .with_webview(move |platform_webview| unsafe {
                let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
                let back: bool = objc2::msg_send![view, canGoBack];
                let forward: bool = objc2::msg_send![view, canGoForward];
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send((back, forward));
                }
            })
            .map_err(|error| error.to_string())?;
        let (back, forward) = tokio::time::timeout(Duration::from_secs(2), receiver)
            .await
            .map_err(|_| "The page did not respond.".to_owned())?
            .map_err(|_| "The page closed before it responded.".to_owned())?;
        Ok(BrowserNavState {
            can_go_back: back,
            can_go_forward: forward,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Ok(BrowserNavState {
            can_go_back: true,
            can_go_forward: true,
        })
    }
}
