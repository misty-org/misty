//! Streaming HTTP for account requests. Only the native cookie jar sees JWTs.
use super::auth_cookies::{self, AccountClient};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, OnceLock},
};
use tauri::Manager;
use tokio::sync::{Mutex as AsyncMutex, Notify};

struct RequestSlot {
    cancel: Notify,
    response: AsyncMutex<Option<reqwest::Response>>,
}
#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, Arc<RequestSlot>>,
    canceled: HashSet<String>,
}
static REQUESTS: OnceLock<Mutex<RequestRegistry>> = OnceLock::new();
fn requests() -> &'static Mutex<RequestRegistry> {
    REQUESTS.get_or_init(Default::default)
}
fn forget(id: &str) {
    if let Ok(mut map) = requests().lock() {
        map.active.remove(id);
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestHead {
    request_id: String,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    has_body: bool,
    progress: tauri::ipc::JavaScriptChannelId,
}

#[derive(Serialize)]
pub struct ResponseHead {
    status: u16,
    headers: Vec<(String, String)>,
    url: String,
}

#[tauri::command]
pub async fn auth_http_start(
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<ResponseHead, String> {
    let app = webview.app_handle().clone();
    let meta = request
        .headers()
        .get("x-misty-request")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing request metadata")?;
    if meta.len() > 65536 {
        return Err("Request metadata too large".into());
    }
    let meta = percent_encoding::percent_decode_str(meta)
        .decode_utf8()
        .map_err(|_| "Invalid request metadata")?;
    let RequestHead {
        request_id,
        url,
        method,
        headers,
        has_body,
        progress,
    } = serde_json::from_str(&meta).map_err(|_| "Invalid request metadata")?;
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("Expected binary request body".into()),
    };
    let progress: tauri::ipc::Channel<[u64; 2]> = progress.channel_on(webview);
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Invalid request ID")?;
    let url = auth_cookies::server(&url)?;
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Invalid HTTP method")?;
    let login = method == reqwest::Method::POST
        && [
            "/login",
            "/register",
            "/self-host/bootstrap",
            "/self-host/enroll",
        ]
        .iter()
        .any(|path| url.path().ends_with(path));
    let refresh = method == reqwest::Method::POST && url.path().ends_with("/auth/refresh");
    // A failed attempt to add another account must not change the active jar.
    let client = if login {
        AccountClient::new()?
    } else {
        auth_cookies::current(&url)?
    };
    let mut builder = client.http.request(method, url.clone());
    for (name, value) in headers {
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "cookie" | "authorization" | "host" | "content-length" | "connection"
        ) {
            continue;
        }
        builder = builder.header(&name, &value);
    }
    builder = builder.header("X-Misty-CSRF", "1");
    if has_body {
        let total = body.len() as u64;
        let stream = async_stream::stream! {
            let mut sent = 0;
            let mut reported = std::time::Instant::now();
            for chunk in body.chunks(256*1024) {
                yield Ok::<Vec<u8>,std::io::Error>(chunk.to_vec());
                sent += chunk.len() as u64;
                if sent == total || reported.elapsed().as_millis() >= 50 {
                    let _ = progress.send([sent,total]);
                    reported = std::time::Instant::now();
                }
            }
        };
        builder = builder
            .header(reqwest::header::CONTENT_LENGTH, total)
            .body(reqwest::Body::wrap_stream(stream));
    }
    let slot = Arc::new(RequestSlot {
        cancel: Notify::new(),
        response: AsyncMutex::new(None),
    });
    {
        let mut map = requests()
            .lock()
            .map_err(|_| "HTTP request registry unavailable")?;
        if map.canceled.remove(&request_id) {
            return Err("Request aborted".into());
        }
        if map.active.contains_key(&request_id) {
            return Err("Request ID already in use".into());
        }
        map.active.insert(request_id.clone(), slot.clone());
    }
    let outcome = async {
        // Hold the jar's refresh lock until the rotated cookies are persisted.
        let _refresh_guard = if refresh {
            Some(client.refresh_lock.clone().lock_owned().await)
        } else {
            None
        };
        let response = tokio::select! {
            response = builder.send() => response.map_err(|_| "Could not reach the Misty server")?,
            _ = slot.cancel.notified() => return Err("Request aborted".to_string()),
        };
        if response.headers().contains_key(reqwest::header::SET_COOKIE) {
            let account = client.persist(&url)?;
            if account.is_none() || (login && response.status().is_success()) {
                super::browser_sync::change_account(Some(&app), || {
                    if login && response.status().is_success() && account.is_some() {
                        auth_cookies::activate(&url, client.clone())?;
                    }
                    Ok(())
                })
                .await?;
            }
        }
        let head = ResponseHead {
            status: response.status().as_u16(),
            url: response.url().to_string(),
            headers: response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    if name == reqwest::header::SET_COOKIE {
                        return None;
                    }
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.to_string(), value.to_string()))
                })
                .collect(),
        };
        *slot.response.lock().await = Some(response);
        Ok(head)
    }
    .await;
    if outcome.is_err() {
        forget(&request_id);
    }
    outcome
}

#[tauri::command]
pub async fn auth_http_read(request_id: String) -> Result<Option<Vec<u8>>, String> {
    let slot = requests()
        .lock()
        .map_err(|_| "HTTP request registry unavailable")?
        .active
        .get(&request_id)
        .cloned()
        .ok_or("Request aborted")?;
    let outcome = async {
        let mut response = slot.response.lock().await;
        let response = response.as_mut().ok_or("Response is not ready")?;
        tokio::select! {
            chunk = response.chunk() => chunk.map(|chunk|chunk.map(|bytes|bytes.to_vec())).map_err(|_| "Could not read the Misty response".to_owned()),
            _ = slot.cancel.notified() => Err("Request aborted".to_owned()),
        }
    }.await;
    if !matches!(outcome, Ok(Some(_))) {
        forget(&request_id);
    }
    outcome
}

#[tauri::command]
pub async fn auth_http_cancel(request_id: String) -> Result<(), String> {
    let mut map = requests()
        .lock()
        .map_err(|_| "HTTP request registry unavailable")?;
    if let Some(slot) = map.active.remove(&request_id) {
        slot.cancel.notify_one();
    } else {
        if map.canceled.len() > 4096 {
            map.canceled.clear();
        }
        map.canceled.insert(request_id);
    }
    Ok(())
}
