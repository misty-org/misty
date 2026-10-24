//! Commands from the Misty app itself: answering a save offer and managing saved sign-ins in Settings.
use super::*;

pub(super) fn require_main(webview: &Webview) -> Result<(), String> {
    if crate::infra::space_windows::is_person_window(webview.label()) {
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
