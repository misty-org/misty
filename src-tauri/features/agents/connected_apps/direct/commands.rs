use std::collections::HashMap;

use serde::Serialize;
use serde_json::json;
use sha2::Digest;
use tauri::{Emitter, Manager};

use super::super::tools::{rejected, Failure};
use super::{catalog, oauth, store, tools};

pub const CHANGED_EVENT: &str = "direct-apps://changed";
const MAX_CHECKS: usize = 40;
const PAGE: usize = 60;
const ICON_LIMIT: usize = 512 << 10;
const MISS_RETRY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

fn person(webview: &tauri::Webview) -> Result<String, Failure> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(super::super::window_account(webview.label()))
    } else {
        Err(rejected(
            "not_allowed",
            "Only a profile's window can connect apps.",
        ))
    }
}

fn http() -> Result<reqwest::Client, Failure> {
    crate::engine_config::support::http_client()
        .map_err(|_| rejected("apps_unreachable", "Misty couldn't reach the internet."))
}

fn storage(message: String) -> Failure {
    rejected("apps_storage", message)
}

#[derive(Serialize)]
pub struct CatalogPage {
    apps: Vec<catalog::CatalogApp>,
    total: usize,
}

#[tauri::command]
pub async fn direct_apps_catalog(
    webview: tauri::Webview,
    search: String,
    offset: usize,
) -> Result<CatalogPage, Failure> {
    person(&webview)?;
    let search = search.trim();
    if search.len() > 100 {
        return Err(rejected("invalid_request", "That search is too long."));
    }
    let (mut apps, total) = catalog::page(search, offset, PAGE);
    if !search.is_empty() && offset == 0 {
        if let Ok(newer) = catalog::search_registry(&http()?, search).await {
            apps.extend(newer);
        }
    }
    Ok(CatalogPage { apps, total })
}

#[tauri::command]
pub async fn direct_apps_icon(app: tauri::AppHandle, url: String) -> Result<String, Failure> {
    let unusable = || rejected("invalid_request", "That logo can't be shown.");
    if !url.starts_with("https://") || url.len() > 2048 {
        return Err(unusable());
    }
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|_| unusable())?
        .join("app-logos");
    let name = format!("{:x}", sha2::Sha256::digest(url.as_bytes()));
    let file = folder.join(&name);
    if let Ok(saved) = file_access::fs_async::read_to_string(&file).await {
        if !saved.is_empty() {
            return Ok(saved);
        }
        let fresh = file_access::fs_async::metadata(&file)
            .await
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age < MISS_RETRY);
        if fresh {
            return Err(unusable());
        }
    }
    let fetched = async {
        let response = http().ok()?.get(&url).send().await.ok()?;
        let kind = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|kind| kind.split(';').next().unwrap_or(kind).trim().to_owned())
            .filter(|kind| kind.starts_with("image/"))?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        (!bytes.is_empty() && bytes.len() <= ICON_LIMIT).then(|| {
            use base64::Engine as _;
            format!(
                "data:{kind};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            )
        })
    }
    .await;
    let _ = file_access::fs_async::create_dir_all(&folder).await;
    let _ = file_access::fs_async::write(&file, fetched.as_deref().unwrap_or_default()).await;
    fetched.ok_or_else(unusable)
}

#[tauri::command]
pub async fn direct_apps_check(
    webview: tauri::Webview,
    urls: Vec<String>,
) -> Result<HashMap<String, String>, Failure> {
    person(&webview)?;
    let http = http()?;
    let checks = urls
        .into_iter()
        .filter(|url| url.starts_with("https://"))
        .take(MAX_CHECKS)
        .map(|url| {
            let http = http.clone();
            async move {
                let code = catalog::check(&http, &url).await;
                (url, code)
            }
        });
    Ok(futures_util::future::join_all(checks)
        .await
        .into_iter()
        .collect())
}

#[tauri::command]
pub async fn direct_apps_list(
    webview: tauri::Webview,
) -> Result<Vec<store::ConnectionView>, Failure> {
    let account = person(&webview)?;
    let list = tools::connections(&account).await?;
    Ok(list.iter().map(store::Connection::view).collect())
}

#[derive(Serialize)]
pub struct Started {
    url: String,
}

fn plain_page(address: &str) -> Option<String> {
    let page = url::Url::parse(address).ok()?;
    let local = matches!(page.host_str(), Some("localhost" | "127.0.0.1"));
    let allowed = page.scheme() == "https" || (page.scheme() == "http" && local);
    (allowed && page.query().is_none() && page.fragment().is_none() && page.username().is_empty())
        .then(|| page.into())
}

#[tauri::command]
pub async fn direct_apps_connect(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    url: String,
    name: String,
    done_page: Option<String>,
) -> Result<Started, Failure> {
    let account = person(&webview)?;
    let done_page = done_page.as_deref().and_then(plain_page);
    let name = name.trim().chars().take(60).collect::<String>();
    if !url.starts_with("https://") || name.is_empty() {
        return Err(rejected("invalid_request", "That app can't be connected."));
    }
    let http = http()?;
    let found = match oauth::discover(&http, &url).await {
        oauth::Access::Keyless(found) => found,
        oauth::Access::Open => {
            return Err(rejected(
                "invalid_request",
                format!("{name} doesn't need a sign-in."),
            ))
        }
        oauth::Access::NeedsApp => {
            return Err(rejected(
                "invalid_request",
                format!("{name} only lets apps it approved ahead of time sign in, so Misty can't connect it directly."),
            ))
        }
        oauth::Access::Unreachable => {
            return Err(rejected(
                "apps_unreachable",
                format!("{name} didn't answer. Try again."),
            ))
        }
    };
    let sign_in = oauth::begin(&http, &found, done_page)
        .await
        .map_err(|message| rejected("apps_rejected", message))?;
    let authorize_url = sign_in.authorize_url.clone();
    let label = webview.label().to_owned();
    tauri::async_runtime::spawn(async move {
        let registered = sign_in.registered.clone();
        let outcome = match sign_in.finish(&http, &found).await {
            Ok(tokens) => {
                let account_key = account.clone();
                let (url, name) = (url.clone(), name.clone());
                store::blocking(move || {
                    store::update(&account_key, |items| {
                        let wanted = catalog::app_key(&url);
                        let app_name = store::unique_app(items, &wanted, &url);
                        let connection = store::Connection {
                            id: format!("direct_{}", uuid::Uuid::new_v4().simple()),
                            app: app_name,
                            name,
                            url,
                            client_id: registered.client_id,
                            client_secret: registered.client_secret,
                            token_endpoint: found.token_endpoint.clone(),
                            resource: found.resource.clone(),
                            access_token: tokens.access_token,
                            refresh_token: tokens.refresh_token,
                            expires_at: tokens.expires_at,
                            created_at: chrono::Utc::now().to_rfc3339(),
                        };
                        items.push(connection);
                    })
                })
                .await
                .map(|_| ())
            }
            Err(message) => Err(message),
        };
        let event = match outcome {
            Ok(()) => json!({ "ok": true }),
            Err(message) => json!({ "ok": false, "message": message }),
        };
        if app.get_webview(&label).is_some() {
            let _ = app.emit_to(label.as_str(), CHANGED_EVENT, event);
        }
    });
    Ok(Started { url: authorize_url })
}

#[tauri::command]
pub async fn direct_apps_disconnect(webview: tauri::Webview, id: String) -> Result<(), Failure> {
    let account = person(&webview)?;
    let gone = id.clone();
    store::blocking(move || store::update(&account, |items| items.retain(|item| item.id != gone)))
        .await
        .map_err(storage)?;
    tools::forget_tools(&id);
    Ok(())
}

#[cfg(test)]
pub(super) fn test_plain_page(address: &str) -> Option<String> {
    plain_page(address)
}
