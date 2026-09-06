use std::{
    collections::{HashMap, HashSet},
    ffi::CString,
    os::raw::c_char,
    sync::Mutex,
};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use url::Url;

use super::browser_shortcuts::{forget_shortcut_token, BrowserShortcutBinding};

#[derive(Default)]
pub struct BrowserSessionState {
    sessions: Mutex<HashMap<String, BrowserSession>>,
    pub(super) shortcut_bindings: Mutex<Vec<BrowserShortcutBinding>>,
    pub(super) shortcut_tokens: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct BrowserSession {
    scope_id: String,
    grants: HashMap<String, BrowserGrant>,
}

struct BrowserGrant {
    agent_id: String,
    capabilities: HashSet<String>,
    expires_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    scope_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBoundsRequest {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCaptureRegionRequest {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
pub struct BrowserWebviewIdRequest {
    id: String,
}

#[derive(Deserialize)]
pub struct BrowserNavigateRequest {
    id: String,
    url: String,
}

#[derive(Deserialize)]
pub struct BrowserThemeRequest {
    theme: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCompanionStateRequest {
    target_id: String,
    visible: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentGrantRequest {
    id: String,
    scope_id: String,
    grant_id: String,
    agent_id: String,
    capabilities: Vec<String>,
    expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentGrantRevokeRequest {
    id: String,
    grant_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentExecuteRequest {
    scope_id: String,
    grant_id: String,
    agent_id: String,
    operation: String,
    #[serde(default)]
    input: Value,
}

extern "C" {
    fn misty_ios_browser_create(
        id: *const c_char,
        url: *const c_char,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> bool;
    fn misty_ios_browser_set_bounds(id: *const c_char, x: f64, y: f64, width: f64, height: f64);
    fn misty_ios_browser_navigate(id: *const c_char, url: *const c_char);
    fn misty_ios_browser_action(id: *const c_char, action: *const c_char);
    fn misty_ios_browser_set_visible(id: *const c_char, visible: bool);
    fn misty_ios_browser_hide_all();
    fn misty_ios_browser_close(id: *const c_char);
}

#[tauri::command]
pub async fn browser_webview_create(
    _app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewCreateRequest,
) -> Result<(), String> {
    validate_url(&request.url)?;
    validate_bounds(request.x, request.y, request.width, request.height)?;
    let id = c_string(&request.id)?;
    let url = c_string(&request.url)?;
    let created = unsafe {
        misty_ios_browser_create(
            id.as_ptr(),
            url.as_ptr(),
            request.x,
            request.y,
            request.width,
            request.height,
        )
    };
    if !created {
        return Err("The iOS Browser view could not be created.".to_owned());
    }
    state.sessions.lock().map_err(lock_error)?.insert(
        request.id,
        BrowserSession {
            scope_id: request.scope_id,
            grants: HashMap::new(),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn browser_webview_set_bounds(
    _app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<(), String> {
    validate_bounds(request.x, request.y, request.width, request.height)?;
    let id = c_string(&request.id)?;
    unsafe {
        misty_ios_browser_set_bounds(
            id.as_ptr(),
            request.x,
            request.y,
            request.width,
            request.height,
        )
    };
    Ok(())
}

#[tauri::command]
pub fn browser_webview_reconcile(
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<bool, String> {
    browser_webview_set_bounds(app, request)?;
    Ok(true)
}

#[tauri::command]
pub async fn browser_webview_capture_region(
    _app: AppHandle,
    request: BrowserCaptureRegionRequest,
) -> Result<Value, String> {
    let _ = (
        request.id,
        request.x,
        request.y,
        request.width,
        request.height,
    );
    Err("Region capture is not available in the iOS Browser yet.".to_owned())
}

#[tauri::command]
pub fn browser_webview_navigate(
    _app: AppHandle,
    request: BrowserNavigateRequest,
) -> Result<(), String> {
    validate_url(&request.url)?;
    let id = c_string(&request.id)?;
    let url = c_string(&request.url)?;
    unsafe { misty_ios_browser_navigate(id.as_ptr(), url.as_ptr()) };
    Ok(())
}

#[tauri::command]
pub fn browser_webview_set_theme(
    _app: AppHandle,
    request: BrowserThemeRequest,
) -> Result<(), String> {
    let _ = request.theme;
    Ok(())
}

macro_rules! browser_action {
    ($name:ident, $action:literal) => {
        #[tauri::command]
        pub fn $name(_app: AppHandle, request: BrowserWebviewIdRequest) -> Result<(), String> {
            let id = c_string(&request.id)?;
            let action = c_string($action)?;
            unsafe { misty_ios_browser_action(id.as_ptr(), action.as_ptr()) };
            Ok(())
        }
    };
}

browser_action!(browser_webview_back, "back");
browser_action!(browser_webview_forward, "forward");
browser_action!(browser_webview_reload, "reload");

#[tauri::command]
pub fn browser_webview_show(
    _app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    set_visible(&request.id, true)
}

#[tauri::command]
pub fn browser_webview_hide(
    _app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    set_visible(&request.id, false)
}

#[tauri::command]
pub fn browser_webviews_hide_all(_app: AppHandle) -> Result<(), String> {
    unsafe { misty_ios_browser_hide_all() };
    Ok(())
}

#[tauri::command]
pub fn browser_webviews_park_all(app: AppHandle) -> Result<(), String> {
    browser_webviews_hide_all(app)
}

#[tauri::command]
pub fn browser_webviews_set_overlay_active(app: AppHandle, active: bool) -> Result<(), String> {
    if active {
        browser_webviews_hide_all(app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_webviews_set_pointer_tracking(
    _app: AppHandle,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn browser_webviews_set_companion(
    _app: AppHandle,
    request: BrowserCompanionStateRequest,
) -> Result<(), String> {
    let _ = (request.target_id, request.visible);
    Ok(())
}

#[tauri::command]
pub fn browser_webview_close(
    _app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    state
        .sessions
        .lock()
        .map_err(lock_error)?
        .remove(&request.id);
    forget_shortcut_token(&state, &request.id);
    let id = c_string(&request.id)?;
    unsafe { misty_ios_browser_close(id.as_ptr()) };
    Ok(())
}

#[tauri::command]
pub fn browser_agent_grant_register(
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentGrantRequest,
) -> Result<(), String> {
    let expires_at = DateTime::parse_from_rfc3339(&request.expires_at)
        .map_err(|_| "Browser grant expiry is invalid.".to_owned())?
        .with_timezone(&Utc);
    let capabilities = request.capabilities.into_iter().collect::<HashSet<_>>();
    if expires_at <= Utc::now()
        || capabilities.is_empty()
        || capabilities
            .iter()
            .any(|value| !is_browser_capability(value))
    {
        return Err("Browser grant is invalid or expired.".to_owned());
    }
    let mut sessions = state.sessions.lock().map_err(lock_error)?;
    let session = sessions
        .get_mut(&request.id)
        .filter(|session| session.scope_id == request.scope_id)
        .ok_or_else(|| "Browser grant does not match this tab.".to_owned())?;
    session.grants.insert(
        request.grant_id,
        BrowserGrant {
            agent_id: request.agent_id,
            capabilities,
            expires_at,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn browser_agent_grant_revoke(
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentGrantRevokeRequest,
) -> Result<(), String> {
    if let Some(session) = state
        .sessions
        .lock()
        .map_err(lock_error)?
        .get_mut(&request.id)
    {
        session.grants.remove(&request.grant_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_agent_execute(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let id = validate_grant(&state, &request)?;
    match request.operation.as_str() {
        "browser.navigate" => {
            let url = request
                .input
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "A URL is required.".to_owned())?;
            browser_webview_navigate(
                app,
                BrowserNavigateRequest {
                    id,
                    url: url.to_owned(),
                },
            )?;
            Ok(json!({ "url": url }))
        }
        "browser.downloads.list" => Ok(json!({ "downloads": [] })),
        _ => Err("This Browser agent operation is not available on iOS.".to_owned()),
    }
}

fn validate_grant(
    state: &BrowserSessionState,
    request: &BrowserAgentExecuteRequest,
) -> Result<String, String> {
    let mut sessions = state.sessions.lock().map_err(lock_error)?;
    let (id, session) = sessions
        .iter_mut()
        .find(|(_, session)| session.scope_id == request.scope_id)
        .ok_or_else(|| "The granted Browser tab is not open.".to_owned())?;
    session
        .grants
        .retain(|_, grant| grant.expires_at > Utc::now());
    let valid = session.grants.get(&request.grant_id).is_some_and(|grant| {
        grant.agent_id == request.agent_id && grant.capabilities.contains(&request.operation)
    });
    valid
        .then(|| id.clone())
        .ok_or_else(|| "Browser agent access is not active for this operation.".to_owned())
}

fn set_visible(id: &str, visible: bool) -> Result<(), String> {
    let id = c_string(id)?;
    unsafe { misty_ios_browser_set_visible(id.as_ptr(), visible) };
    Ok(())
}

fn validate_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "Browser URL is invalid.".to_owned())?;
    (matches!(url.scheme(), "http" | "https") || url.as_str() == "about:blank")
        .then_some(())
        .ok_or_else(|| "Only HTTP and HTTPS URLs can open in Browser.".to_owned())
}

fn validate_bounds(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    (x.is_finite()
        && y.is_finite()
        && width.is_finite()
        && height.is_finite()
        && width >= 1.0
        && height >= 1.0)
        .then_some(())
        .ok_or_else(|| "Browser bounds are invalid.".to_owned())
}

fn c_string(value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| "Browser value contains invalid data.".to_owned())
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Browser state is unavailable.".to_owned()
}

fn is_browser_capability(value: &str) -> bool {
    matches!(
        value,
        "browser.inspect" | "browser.navigate" | "browser.click" | "browser.downloads.list"
    )
}
