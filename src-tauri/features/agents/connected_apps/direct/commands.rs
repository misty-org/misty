//! The native commands behind connecting apps directly. Only a person's window may call them; the
//! tokens never leave native code.
use std::collections::HashMap;

use serde::Serialize;
use serde_json::json;
use sha2::Digest;
use tauri::{Emitter, Manager};

use super::super::tools::{rejected, Failure};
use super::{catalog, oauth, store, tools};

/// Sent to the window when a sign-in that began there ends.
pub const CHANGED_EVENT: &str = "direct-apps://changed";
const MAX_CHECKS: usize = 40;
/// Apps per catalog page.
const PAGE: usize = 60;
const ICON_LIMIT: usize = 512 << 10;

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
    /// How many shipped apps match, for paging.
    total: usize,
}

/// One page of the apps to connect, matching `search`. The first page of a search also brings the
/// registry's makers that are newer than this build's catalog.
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
        // The directory being away only means nothing newer is found.
        if let Ok(newer) = catalog::search_registry(&http()?, search).await {
            apps.extend(newer);
        }
    }
    Ok(CatalogPage { apps, total })
}

/// A maker's logo as a `data:` address, fetched once by native code and kept on this computer,
/// so pages never load it from the maker's site themselves.
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
    if let Ok(saved) = tokio::fs::read_to_string(&file).await {
        return if saved.is_empty() { Err(unusable()) } else { Ok(saved) };
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
    // A logo that couldn't be had is remembered as empty, so it isn't asked for on every view.
    let _ = tokio::fs::create_dir_all(&folder).await;
    let _ = tokio::fs::write(&file, fetched.as_deref().unwrap_or_default()).await;
    fetched.ok_or_else(unusable)
}

/// What a sign-in to each server takes: `keyless`, `open`, `needs_app` or `unreachable`.
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

/// This account's direct connections, without their tokens.
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

/// The page to end a sign-in on, when it is a plain web address: https, or http on this computer
/// while developing the website, with no query or fragment that could carry anything along.
fn plain_page(address: &str) -> Option<String> {
    let page = url::Url::parse(address).ok()?;
    let local = matches!(page.host_str(), Some("localhost" | "127.0.0.1"));
    let allowed = page.scheme() == "https" || (page.scheme() == "http" && local);
    (allowed && page.query().is_none() && page.fragment().is_none() && page.username().is_empty())
        .then(|| page.into())
}

/// Starts a sign-in: returns the address to open in the browser and finishes in the background,
/// telling the window when it is done.
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

/// Forgets a connection on this computer. The app may keep its record of the sign-in until the
/// person removes it there.
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
