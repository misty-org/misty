use super::session::{self, AccountClient, Captured, RefreshAnswer};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, OnceLock},
};
use tauri::Manager;
use tokio::sync::{Mutex as AsyncMutex, Notify};

enum Answer {
    Remote(reqwest::Response),
    Local(Option<Vec<u8>>),
}
struct RequestSlot {
    cancel: Notify,
    response: AsyncMutex<Option<Answer>>,
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

const LOGIN_PATHS: [&str; 4] = [
    "/login",
    "/register",
    "/auth/google/complete",
    "/auth/confirm-email/sign-in",
];

fn body_from_json(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    use serde_json::Value;
    let byte = |item: &Value| item.as_u64().and_then(|byte| u8::try_from(byte).ok());
    let bytes: Option<Vec<u8>> = match value {
        Value::Null => Some(Vec::new()),
        Value::Array(items) => items.iter().map(byte).collect(),
        Value::Object(fields) => (0..fields.len())
            .map(|index| fields.get(&index.to_string()).and_then(byte))
            .collect(),
        _ => None,
    };
    bytes.ok_or_else(|| "Expected binary request body".to_owned())
}

fn renderer_may_set(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "cookie"
            | "authorization"
            | "origin"
            | "host"
            | "content-length"
            | "connection"
            | "user-agent"
            | "x-misty-token-transport"
            | "x-misty-access-token"
            | "x-misty-refresh-token"
            | "x-misty-session-ended"
            | "x-misty-models"
    )
}

async fn session_ended(app: &tauri::AppHandle, url: &url::Url) -> Result<(), String> {
    crate::browser::profiles::change_account(Some(app), || {
        session::set_account(url, None);
        Ok(())
    })
    .await
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
        tauri::ipc::InvokeBody::Json(value) => body_from_json(value)?,
    };
    let progress: tauri::ipc::Channel<[u64; 2]> = progress.channel_on(webview);
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Invalid request ID")?;
    let url = session::server(&url)?;
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Invalid HTTP method")?;
    let posted = |path: &str| method == reqwest::Method::POST && url.path().ends_with(path);
    let login = LOGIN_PATHS.iter().any(|path| posted(path));
    let refresh = posted("/auth/refresh");
    let logout = posted("/logout");
    let client = if login {
        AccountClient::new()?
    } else {
        session::current(&url)?
    };
    let used_access = client.access_header();
    let bearer = if logout {
        client.refresh_header(&url).or(used_access.clone())
    } else {
        used_access.clone()
    };
    let mut builder = client.http.request(method, url.clone());
    for (name, value) in headers {
        if renderer_may_set(&name) {
            builder = builder.header(&name, &value);
        }
    }
    if let Some(bearer) = bearer {
        builder = builder.header(
            reqwest::header::AUTHORIZATION,
            session::authorization(&bearer)?,
        );
    }
    builder = builder
        .header(session::TOKEN_TRANSPORT.0, session::TOKEN_TRANSPORT.1)
        .header("X-Misty-CSRF", "1");
    if has_body {
        let total = body.len() as u64;
        let mut sent = 0;
        let mut reported = std::time::Instant::now();
        let stream = futures_util::stream::poll_fn(move |_| {
            if sent > 0 && (sent == total || reported.elapsed().as_millis() >= 50) {
                let _ = progress.send([sent, total]);
                reported = std::time::Instant::now();
            }
            let start = sent as usize;
            let end = body.len().min(start + 256 * 1024);
            sent = end as u64;
            std::task::Poll::Ready(
                (start < end).then(|| Ok::<Vec<u8>, std::io::Error>(body[start..end].to_vec())),
            )
        });
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
        if refresh {
            let answer = tokio::select! {
                answer = client.rotate(url.clone(), used_access) => answer?,
                _ = slot.cancel.notified() => return Err("Request aborted".to_string()),
            };
            if answer.ended {
                session_ended(&app, &url).await?;
            }
            let RefreshAnswer { status, body, .. } = answer;
            *slot.response.lock().await = Some(Answer::Local(Some(body)));
            return Ok(ResponseHead {
                status,
                url: url.to_string(),
                headers: Vec::new(),
            });
        }
        let response = tokio::select! {
            response = builder.send() => response.map_err(|_| "Could not reach the Misty server")?,
            _ = slot.cancel.notified() => return Err("Request aborted".to_string()),
        };
        match client.capture(&url, response.headers())? {
            Captured::Signed if login && response.status().is_success() => {
                crate::browser::profiles::change_account(Some(&app), || {
                    session::activate(&url, client.clone())
                })
                .await?;
            }
            Captured::Ended => session_ended(&app, &url).await?,
            Captured::Signed | Captured::Nothing => {}
        }
        let head = ResponseHead {
            status: response.status().as_u16(),
            url: response.url().to_string(),
            headers: session::renderer_headers(response.headers()),
        };
        *slot.response.lock().await = Some(Answer::Remote(response));
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
        match response.as_mut().ok_or("Response is not ready")? {
            Answer::Local(body) => Ok(body.take().filter(|body| !body.is_empty())),
            Answer::Remote(response) => tokio::select! {
                chunk = response.chunk() => chunk.map(|chunk|chunk.map(|bytes|bytes.to_vec())).map_err(|_| "Could not read the Misty response".to_owned()),
                _ = slot.cancel.notified() => Err("Request aborted".to_owned()),
            },
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

#[cfg(test)]
mod tests {
    #[test]
    fn a_body_sent_as_json_reads_as_its_bytes() {
        use super::body_from_json;
        assert_eq!(
            body_from_json(&serde_json::json!([1, 2, 255])).unwrap(),
            [1, 2, 255]
        );
        assert_eq!(
            body_from_json(&serde_json::json!({ "1": 7, "0": 6 })).unwrap(),
            [6, 7]
        );
        assert!(body_from_json(&serde_json::json!({})).unwrap().is_empty());
        assert!(body_from_json(&serde_json::Value::Null).unwrap().is_empty());
        assert!(body_from_json(&serde_json::json!("text")).is_err());
        assert!(body_from_json(&serde_json::json!([256])).is_err());
    }

    use super::renderer_may_set;

    #[test]
    fn the_renderer_cannot_set_session_headers() {
        for name in [
            "Authorization",
            "Cookie",
            "Origin",
            "X-Misty-Token-Transport",
            "x-misty-access-token",
            "X-Misty-Refresh-Token",
            "X-Misty-Session-Ended",
            "X-Misty-Models",
        ] {
            assert!(!renderer_may_set(name), "{name}");
        }
        assert!(renderer_may_set("Content-Type"));
        assert!(renderer_may_set("X-Misty-Automation"));
    }
}
