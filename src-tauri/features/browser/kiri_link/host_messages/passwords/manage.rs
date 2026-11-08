//! Commands from the Misty app itself: answering a save offer and managing saved sign-ins in Settings.
use super::*;

/// The profile whose passwords this window manages: its own. Only a profile's windows (no
/// incognito windows, no pages) can.
pub(crate) fn managed_profile(webview: &Webview) -> Result<String, String> {
    let label = webview.window().label().to_owned();
    if !crate::browser::app_windows::is_person_window(webview.label())
        || !crate::browser::app_windows::is_person_window(&label)
    {
        return Err("Only Misty's trusted shell can manage passwords.".into());
    }
    crate::browser::app_windows::profile_for_window(&label)
        .ok_or_else(|| "Only Misty's trusted shell can manage passwords.".to_owned())
}

/// Fills the sign-in the person clicked in Misty's menu. This is the only way a password reaches
/// a page, and a page has no way to call it. Incognito windows have no account data but do fill
/// their profile's sign-ins, so this name stays outside `browser_passwords`, which they can't reach.
#[tauri::command]
pub async fn browser_page_password_fill(
    webview: Webview,
    app: AppHandle,
    id: String,
    login: String,
) -> Result<(), String> {
    let label = webview_label(&id)?;
    let page = app.get_webview(&label).ok_or("This page has closed.")?;
    if page.window().label() != webview.window().label() {
        return Err("This window doesn't show that page.".into());
    }
    let profile = page_profile(&app, &id).ok_or(UNAVAILABLE)?;
    let origin = page_origin(&app, &id).ok_or("This page can't take a sign-in.")?;
    let (_, saved) = logins(&profile)
        .await?
        .into_iter()
        .find(|(candidate, _)| *candidate == login)
        .ok_or("This sign-in was removed.")?;
    // Filled only into the site it was saved for, as it is now.
    if saved.origin != origin || page_origin(&app, &id).as_deref() != Some(&origin) {
        return Err("This page has moved to another site.".into());
    }
    let script = Zeroizing::new(format!(
        "window.__MISTY_PASSWORDS__?.fill({}, {});",
        Value::from(saved.username),
        Value::from(saved.password.as_str()),
    ));
    reply(&app, &id, script.to_string());
    // The click moved focus to Misty's window; typing belongs back in the page.
    page.set_focus().map_err(|error| error.to_string())
}

/// Saves (or drops) the sign-in a page just submitted. Offers expire after ten minutes.
#[tauri::command]
pub async fn browser_password_offer_respond(
    webview: Webview,
    id: String,
    save: bool,
) -> Result<(), String> {
    managed_profile(&webview)?;
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
        save_login(
            &capture.profile,
            &capture.origin,
            &capture.username,
            &capture.password,
        )
        .await?;
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
    let profile = managed_profile(&webview)?;
    let mut list: Vec<SavedLoginSummary> = logins(&profile)
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
    let profile = managed_profile(&webview)?;
    logins(&profile)
        .await?
        .into_iter()
        .find(|(candidate, _)| *candidate == id)
        .map(|(_, login)| login.password)
        .ok_or_else(|| "This sign-in was removed.".to_owned())
}

#[tauri::command]
pub async fn browser_passwords_delete(webview: Webview, id: String) -> Result<(), String> {
    let profile = managed_profile(&webview)?;
    write(&profile, id, None).await
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
    let profile = managed_profile(&webview)?;
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
    let existing = logins(&profile).await?;
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
        &profile,
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
