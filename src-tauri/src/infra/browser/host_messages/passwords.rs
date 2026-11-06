//! Saved passwords and autofill. Sign-ins live in the `passwords` collection of the profile
//! whose pages use them, in the profile's encrypted records, so a page only ever sees its own
//! profile's. The page script says when a sign-in field has focus and reports submitted
//! sign-ins. It runs in the page's own JavaScript world, so nothing it sends can be trusted as the
//! person's choice: the saved sign-ins go to Misty's own interface, never to the page, and only a
//! click there fills one (`browser_page_password_fill`). Misty decides what a page receives from
//! the page's real address, never from what the page claims.
use super::super::*;
use crate::infra::profile_data::ProfileRecords;
use misty_browser_sync::{
    collections::PASSWORDS,
    document::{
        entities::{Kind, Login},
        ViewRecord,
    },
};
use std::collections::HashMap;
use zeroize::Zeroizing;

mod manage;
pub use manage::*;

pub(super) const UNAVAILABLE: &str = "This computer's key storage is unavailable.";

struct PendingCapture {
    /// The profile of the page that submitted it, where it saves whichever window answers.
    profile: String,
    origin: String,
    username: String,
    password: Zeroizing<String>,
    at: std::time::Instant,
}

fn pending() -> &'static Mutex<HashMap<String, PendingCapture>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingCapture>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

pub(super) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(super) fn profile_records(profile: &str) -> Result<ProfileRecords, String> {
    crate::infra::profile_data::profile_records(profile).ok_or_else(|| UNAVAILABLE.to_owned())
}

async fn logins(profile: &str) -> Result<Vec<(String, Login)>, String> {
    let records = profile_records(profile)?
        .records_list(PASSWORDS)
        .await
        .map_err(|_| UNAVAILABLE.to_owned())?;
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

async fn write(profile: &str, id: String, login: Option<Login>) -> Result<(), String> {
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
    profile_records(profile)?
        .records_write(PASSWORDS, vec![(id, record)])
        .await
        .map_err(|_| "The sign-in could not be saved. Try again.".to_owned())
}

/// Adds a sign-in, or updates the password of the one already saved for this
/// site and username.
async fn save_login(
    profile: &str,
    origin: &str,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let now = now_ms();
    let existing = logins(profile)
        .await?
        .into_iter()
        .find(|(_, login)| login.origin == origin && login.username == username);
    let (id, created_at) = match existing {
        Some((id, login)) => (id, login.created_at),
        None => (format!("login:{}", uuid::Uuid::new_v4()), now),
    };
    write(
        profile,
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
pub(super) fn page_origin(app: &AppHandle, id: &str) -> Option<String> {
    let view = app.get_webview(&webview_label(id).ok()?)?;
    let url = view.url().ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

/// The profile a page belongs to, from the window that holds it: an incognito page's is the
/// profile of its window. Never from anything the page says.
pub(super) fn page_profile(app: &AppHandle, id: &str) -> Option<String> {
    let view = app.get_webview(&webview_label(id).ok()?)?;
    crate::infra::profile_windows::profile_for_owner(view.window().label())
}

fn private_session(app: &AppHandle, id: &str) -> bool {
    app.state::<BrowserSessionState>()
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(id).map(|session| session.private))
        .unwrap_or(true)
}

pub(super) fn reply(app: &AppHandle, id: &str, script: String) {
    if let Some(view) = webview_label(id)
        .ok()
        .and_then(|label| app.get_webview(&label))
    {
        let _ = view.eval(script);
    }
}

/// Where a page says its sign-in field is, as fractions of the page, kept inside the page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub(super) struct MenuPlace {
    pub(super) left: f64,
    pub(super) bottom: f64,
    pub(super) width: f64,
}

impl MenuPlace {
    pub(super) fn from_query(values: &HashMap<String, String>) -> Self {
        let fraction = |name: &str| {
            values
                .get(name)
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite())
                .map_or(0.0, |value| value.clamp(0.0, 1.0))
        };
        Self {
            left: fraction("left"),
            bottom: fraction("bottom"),
            width: fraction("width"),
        }
    }
}

/// Tells the window showing this page which sign-ins to offer; none closes the menu.
fn show_menu(app: &AppHandle, id: &str, logins: Vec<Value>, origin: &str, place: MenuPlace) {
    let _ = app.emit_to(
        browser_owner_label(app, id).as_str(),
        "misty://browser-password-menu",
        json!({"id": id, "origin": origin, "logins": logins, "place": place}),
    );
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
    let Some(profile) = page_profile(app, id) else {
        return true;
    };
    let app = app.clone();
    let id = id.to_owned();
    match url.path() {
        "list" => {
            let place = MenuPlace::from_query(&values);
            tauri::async_runtime::spawn(async move {
                let Ok(logins) = logins(&profile).await else {
                    return;
                };
                let offers: Vec<Value> = logins
                    .into_iter()
                    .filter(|(_, login)| login.origin == origin)
                    .map(|(login_id, login)| json!({"id": login_id, "username": login.username}))
                    .collect();
                if offers.is_empty() || page_origin(&app, &id).as_deref() != Some(&origin) {
                    return;
                }
                show_menu(&app, &id, offers, &origin, place);
            });
        }
        "hide" => show_menu(&app, &id, Vec::new(), &origin, MenuPlace::default()),
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
                let Ok(logins) = logins(&profile).await else {
                    return;
                };
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
                            profile: profile.clone(),
                            origin: origin.clone(),
                            username: username.clone(),
                            password,
                            at: std::time::Instant::now(),
                        },
                    );
                }
                // The renderer learns the site and username, never the password, and only the
                // windows the person uses for this profile hear of it.
                crate::infra::profile_windows::emit_to_profile_people(
                    &app,
                    &profile,
                    "misty://browser-password-offer",
                    json!({"id": id, "origin": origin, "username": username, "update": update}),
                );
            });
        }
        _ => {}
    }
    true
}

#[cfg(test)]
mod tests;
