//! Saved passwords and autofill. Sign-ins live in the vault's `passwords`
//! collection, each sealed with the vault key, so the server and any copy of
//! its database hold only ciphertext. The page script asks for sign-ins of its
//! own top-level origin and reports submitted ones; Misty decides what a page
//! receives from the page's real address, never from what the page claims.
use super::super::*;
use misty_browser_sync::{
    collections::PASSWORDS,
    document::{
        entities::{Kind, Login},
        ViewRecord,
    },
};
use std::collections::HashMap;
use zeroize::Zeroizing;

const LOCKED: &str = "Unlock your sync vault to use saved passwords.";

struct PendingCapture {
    origin: String,
    username: String,
    password: Zeroizing<String>,
    at: std::time::Instant,
}

fn pending() -> &'static Mutex<HashMap<String, PendingCapture>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingCapture>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn handle() -> Result<misty_browser_sync::worker::WorkerHandle, String> {
    crate::infra::browser_sync::vault_handle()
        .await
        .ok_or_else(|| LOCKED.to_owned())
}

async fn logins() -> Result<Vec<(String, Login)>, String> {
    let (_, records) = handle()
        .await?
        .records_list(PASSWORDS.into())
        .await
        .map_err(|_| LOCKED.to_owned())?;
    Ok(records
        .into_iter()
        .filter(|record| record.kind == Kind::Login)
        .filter_map(|record| {
            let fields = Value::Object(record.fields.into_iter().collect());
            serde_json::from_value::<Login>(fields)
                .ok()
                .map(|login| (record.id, login))
        })
        .collect())
}

async fn write(id: String, login: Option<Login>) -> Result<(), String> {
    let record = match login {
        Some(login) => {
            let Value::Object(fields) = serde_json::to_value(&login).map_err(|e| e.to_string())?
            else {
                return Err("The sign-in could not be saved.".into());
            };
            misty_browser_sync::document::entities::validate(
                Kind::Login,
                &fields.clone().into_iter().collect(),
            )
            .map_err(|_| "Check the site, username and password.".to_owned())?;
            Some(ViewRecord {
                kind: Kind::Login,
                id: id.clone(),
                fields: fields.into_iter().collect(),
            })
        }
        None => None,
    };
    handle()
        .await?
        .records_write(PASSWORDS.into(), vec![(id, record)])
        .await
        .map_err(|_| "The sign-in could not be saved. Try again.".to_owned())
}

/// Adds a sign-in, or updates the password of the one already saved for this
/// site and username.
async fn save_login(origin: &str, username: &str, password: &str) -> Result<(), String> {
    let now = now_ms();
    let existing = logins()
        .await?
        .into_iter()
        .find(|(_, login)| login.origin == origin && login.username == username);
    let (id, created_at) = match existing {
        Some((id, login)) => (id, login.created_at),
        None => (format!("login:{}", uuid::Uuid::new_v4()), now),
    };
    write(
        id,
        Some(Login {
            origin: origin.to_owned(),
            username: username.to_owned(),
            password: password.to_owned(),
            created_at,
            updated_at: now,
        }),
    )
    .await
}

/// The page's real top-level origin, for http(s) pages only.
fn page_origin(app: &AppHandle, id: &str) -> Option<String> {
    let view = app.get_webview(&webview_label(id).ok()?)?;
    let url = view.url().ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

fn private_session(app: &AppHandle, id: &str) -> bool {
    app.state::<BrowserSessionState>()
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(id).map(|session| session.private))
        .unwrap_or(true)
}

fn reply(app: &AppHandle, id: &str, script: String) {
    if let Some(view) = webview_label(id)
        .ok()
        .and_then(|label| app.get_webview(&label))
    {
        let _ = view.eval(script);
    }
}

/// Handles `misty-passwords:` messages from the page script. Returns whether
/// the message was one.
pub(super) fn forward(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-passwords" {
        return false;
    }
    let values: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return true;
    };
    let token = values.get("token").map(String::as_str).unwrap_or("");
    if !shortcut_token_matches(&state, id, token) {
        return true;
    }
    let Some(origin) = page_origin(app, id) else {
        return true;
    };
    let app = app.clone();
    let id = id.to_owned();
    match url.path() {
        "list" => {
            tauri::async_runtime::spawn(async move {
                let Ok(logins) = logins().await else { return };
                let offers: Vec<Value> = logins
                    .into_iter()
                    .filter(|(_, login)| login.origin == origin)
                    .map(|(login_id, login)| json!({"id": login_id, "username": login.username}))
                    .collect();
                if offers.is_empty() || page_origin(&app, &id).as_deref() != Some(&origin) {
                    return;
                }
                reply(
                    &app,
                    &id,
                    format!(
                        "window.__MISTY_PASSWORDS__?.offer({});",
                        Value::from(offers)
                    ),
                );
            });
        }
        "fill" => {
            let Some(login_id) = values.get("id").cloned() else {
                return true;
            };
            tauri::async_runtime::spawn(async move {
                let Ok(logins) = logins().await else { return };
                let Some((_, login)) = logins
                    .into_iter()
                    .find(|(candidate, _)| *candidate == login_id)
                else {
                    return;
                };
                // Filled only into the site it was saved for, as it is now.
                if login.origin != origin || page_origin(&app, &id).as_deref() != Some(&origin) {
                    return;
                }
                let script = Zeroizing::new(format!(
                    "window.__MISTY_PASSWORDS__?.fill({}, {});",
                    Value::from(login.username),
                    Value::from(login.password.as_str()),
                ));
                reply(&app, &id, script.to_string());
            });
        }
        "capture" => {
            let username = values.get("username").cloned().unwrap_or_default();
            let password = Zeroizing::new(values.get("password").cloned().unwrap_or_default());
            if password.is_empty()
                || password.len() > 4096
                || username.len() > 512
                || private_session(&app, &id)
            {
                return true;
            }
            tauri::async_runtime::spawn(async move {
                let Ok(logins) = logins().await else { return };
                let existing = logins
                    .iter()
                    .find(|(_, login)| login.origin == origin && login.username == username);
                if existing.is_some_and(|(_, login)| login.password == *password) {
                    return;
                }
                let update = existing.is_some();
                if let Ok(mut pending) = pending().lock() {
                    pending.insert(
                        id.clone(),
                        PendingCapture {
                            origin: origin.clone(),
                            username: username.clone(),
                            password,
                            at: std::time::Instant::now(),
                        },
                    );
                }
                // The renderer learns the site and username, never the password.
                let _ = app.emit_to(
                    "main",
                    "misty://browser-password-offer",
                    json!({"id": id, "origin": origin, "username": username, "update": update}),
                );
            });
        }
        _ => {}
    }
    true
}

fn require_main(webview: &Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("Only Misty's trusted shell can manage passwords.".into())
    }
}

/// Saves (or drops) the sign-in a page just submitted. Offers expire after ten minutes.
#[tauri::command]
pub async fn browser_password_offer_respond(
    webview: Webview,
    id: String,
    save: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    let capture = pending()
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&id));
    let Some(capture) = capture.filter(|capture| capture.at.elapsed().as_secs() < 600) else {
        return if save {
            Err("This sign-in is no longer waiting to be saved.".into())
        } else {
            Ok(())
        };
    };
    if save {
        save_login(&capture.origin, &capture.username, &capture.password).await?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLoginSummary {
    id: String,
    origin: String,
    username: String,
    updated_at: i64,
}

/// Saved sign-ins without their passwords, for Settings.
#[tauri::command]
pub async fn browser_passwords_list(webview: Webview) -> Result<Vec<SavedLoginSummary>, String> {
    require_main(&webview)?;
    let mut list: Vec<SavedLoginSummary> = logins()
        .await?
        .into_iter()
        .map(|(id, login)| SavedLoginSummary {
            id,
            origin: login.origin,
            username: login.username,
            updated_at: login.updated_at,
        })
        .collect();
    list.sort_by(|a, b| a.origin.cmp(&b.origin).then(a.username.cmp(&b.username)));
    Ok(list)
}

/// One password, only when the person asks to see or copy it.
#[tauri::command]
pub async fn browser_passwords_reveal(webview: Webview, id: String) -> Result<String, String> {
    require_main(&webview)?;
    logins()
        .await?
        .into_iter()
        .find(|(candidate, _)| *candidate == id)
        .map(|(_, login)| login.password)
        .ok_or_else(|| "This sign-in was removed.".to_owned())
}

#[tauri::command]
pub async fn browser_passwords_delete(webview: Webview, id: String) -> Result<(), String> {
    require_main(&webview)?;
    write(id, None).await
}

/// Adds a sign-in by hand, or edits one (`id`). An empty password keeps the old one.
#[tauri::command]
pub async fn browser_passwords_save(
    webview: Webview,
    id: Option<String>,
    site: String,
    username: String,
    password: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let password = Zeroizing::new(password);
    let site = site.trim();
    let address = if site.contains("://") {
        site.to_owned()
    } else {
        format!("https://{site}")
    };
    let origin = external_url(&address)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
        .map(|url| url.origin().ascii_serialization())
        .ok_or_else(|| "Enter the site's address, such as example.com.".to_owned())?;
    let existing = logins().await?;
    let (record_id, created_at, kept) = match id {
        Some(id) => {
            let (_, login) = existing
                .into_iter()
                .find(|(candidate, _)| *candidate == id)
                .ok_or_else(|| "This sign-in was removed.".to_owned())?;
            (id, login.created_at, Zeroizing::new(login.password))
        }
        None => {
            if password.is_empty() {
                return Err("Enter a password.".into());
            }
            (
                format!("login:{}", uuid::Uuid::new_v4()),
                now_ms(),
                Zeroizing::new(String::new()),
            )
        }
    };
    write(
        record_id,
        Some(Login {
            origin,
            username: username.trim().to_owned(),
            password: if password.is_empty() {
                kept.to_string()
            } else {
                password.to_string()
            },
            created_at,
            updated_at: now_ms(),
        }),
    )
    .await
}
