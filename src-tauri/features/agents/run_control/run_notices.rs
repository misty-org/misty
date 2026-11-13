//! System notices for a chat whose run finished, failed or waits on its person while Misty is in the
//! background. Every person's window follows runs and asks for the same notice; one goes out for all
//! of them, and none while a Misty window is in front. A notice carries the agent's name and the
//! chat's title, never what was asked or answered.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock, PoisonError},
    time::{Duration, Instant},
};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Webview};

/// Windows ask about the same change within moments of each other.
const SAME_NOTICE: Duration = Duration::from_secs(60);
const TITLE_CHARS: usize = 120;
const BODY_CHARS: usize = 200;
/// Tells the window that asked to open the chat, once its notice is clicked.
const OPEN_EVENT: &str = "misty://agent-run-notice-open";

fn sent() -> &'static Mutex<HashMap<String, Instant>> {
    static SENT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    SENT.get_or_init(Default::default)
}

/// Whether this is the first ask about a change. Later ones, from other windows, are the same notice.
fn first_ask(sent: &mut HashMap<String, Instant>, key: &str, now: Instant) -> bool {
    sent.retain(|_, at| now.saturating_duration_since(*at) < SAME_NOTICE);
    if sent.contains_key(key) {
        return false;
    }
    sent.insert(key.to_owned(), now);
    true
}

fn clip(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    let mut clipped: String = text.chars().take(limit - 1).collect();
    clipped.push('…');
    clipped
}

fn misty_in_front(app: &AppHandle) -> bool {
    app.windows()
        .values()
        .any(|window| window.is_focused().unwrap_or(false))
}

fn open_chat(app: &AppHandle, label: &str, route: &str) {
    let Some(window) = app.get_webview(label).map(|webview| webview.window()) else {
        // The window that asked has closed; bring Misty forward at least.
        if let Some(window) = crate::browser::app_windows::primary(app) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = app.emit_to(label, OPEN_EVENT, json!({ "route": route }));
}

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, label: String, title: String, body: String, route: String) {
    // An app run outside its bundle has no identity of its own, as the notification plugin knows.
    let identifier = if tauri::is_dev() {
        "com.apple.Terminal".to_owned()
    } else {
        app.config().identifier.clone()
    };
    let app = app.clone();
    // Waiting for the click holds this thread until the person clicks or clears the notice.
    std::thread::spawn(move || {
        let _ = mac_notification_sys::set_application(&identifier);
        let response = mac_notification_sys::Notification::new()
            .title(&title)
            .message(&body)
            .wait_for_click(true)
            .send();
        if matches!(
            response,
            Ok(mac_notification_sys::NotificationResponse::Click)
        ) {
            open_chat(&app, &label, &route);
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn show(app: &AppHandle, _label: String, title: String, body: String, _route: String) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Shows a notice for a chat's run, unless another window already asked or Misty is in front.
/// True when it went out.
#[tauri::command]
pub fn agent_run_notify(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    kind: String,
    title: String,
    body: String,
    route: String,
) -> Result<bool, String> {
    super::local_runs::window_of_run(&webview, &run_id)?;
    if !matches!(kind.as_str(), "finished" | "failed" | "needs-you") {
        return Err("That isn't something a notice says.".into());
    }
    if !route.starts_with("/agents?") {
        return Err("A notice opens a chat.".into());
    }
    let key = format!("{run_id}:{kind}");
    let first = first_ask(
        &mut sent().lock().unwrap_or_else(PoisonError::into_inner),
        &key,
        Instant::now(),
    );
    if !first || misty_in_front(&app) {
        return Ok(false);
    }
    show(
        &app,
        webview.label().to_owned(),
        clip(&title, TITLE_CHARS),
        clip(&body, BODY_CHARS),
        route,
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_notice_for_every_window_that_asks() {
        let mut sent = HashMap::new();
        let now = Instant::now();
        assert!(first_ask(&mut sent, "r1:finished", now));
        assert!(!first_ask(
            &mut sent,
            "r1:finished",
            now + Duration::from_secs(1)
        ));
        assert!(first_ask(&mut sent, "r1:needs-you", now));
        assert!(first_ask(&mut sent, "r1:finished", now + SAME_NOTICE));
    }

    #[test]
    fn long_text_is_clipped() {
        assert_eq!(clip("  Chat  ", 10), "Chat");
        assert_eq!(clip("abcdef", 4), "abc…");
    }
}
