//! "Transcribe this tab": the page's own audio, through Kiri's media tap.
//! The person starts it; chunks from any page are dropped unless that tab
//! has a session Misty started, so a page cannot inject audio on its own.
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Webview};

fn sessions() -> &'static Mutex<HashMap<String, u64>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}

fn tab_label(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 96 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("That tab can't be captured.".into());
    }
    Ok(format!("misty-browser-{id}"))
}

/// Whether `session` is the live tap for tab `id`.
pub fn allowed(id: &str, session: u64) -> bool {
    session != 0 && sessions().lock().map(|s| s.get(id) == Some(&session)).unwrap_or(false)
}

/// Kiri reported tap audio or a notice from tab `id`.
pub fn forward(app: &AppHandle, id: &str, session: u64, pcm: Option<String>, notice: Option<String>) {
    if !allowed(id, session) {
        return;
    }
    let payload = match (pcm, notice) {
        (Some(pcm), _) => json!({"session": session, "source": "tab", "tab": id, "channel": "system", "pcm": pcm}),
        (_, Some(notice)) => json!({"session": session, "source": "tab", "tab": id, "notice": notice}),
        _ => return,
    };
    let event = if payload.get("pcm").is_some() { "misty://capture-audio" } else { "misty://capture-state" };
    let _ = crate::infra::space_windows::emit_to_primary(&app, event, payload);
}

fn require_main(webview: &Webview) -> Result<(), String> {
    crate::infra::space_windows::is_space_window(webview.label()).then_some(()).ok_or_else(|| "Main Misty window required.".into())
}

/// Starts listening to tab `id` and returns the session its audio carries.
#[tauri::command]
pub fn voice_tab_capture_start(webview: Webview, app: AppHandle, id: String) -> Result<u64, String> {
    require_main(&webview)?;
    let tab = app.get_webview(&tab_label(&id)?).ok_or("That tab isn't open.")?;
    let session = u64::from(rand_u32()) | 1;
    sessions().lock().map_err(|_| "Capture is busy.")?.insert(id, session);
    tab.eval(format!("window.__kiriMediaTap && window.__kiriMediaTap.start({session})"))
        .map_err(|e| e.to_string())?;
    Ok(session)
}

#[tauri::command]
pub fn voice_tab_capture_stop(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    require_main(&webview)?;
    let label = tab_label(&id)?;
    sessions().lock().map_err(|_| "Capture is busy.")?.remove(&id);
    if let Some(tab) = app.get_webview(&label) {
        let _ = tab.eval("window.__kiriMediaTap && window.__kiriMediaTap.stop()");
    }
    Ok(())
}

fn rand_u32() -> u32 {
    rand::random()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_started_session_of_that_tab_is_allowed() {
        sessions().lock().unwrap().insert("tab-a".into(), 41);
        assert!(allowed("tab-a", 41));
        assert!(!allowed("tab-a", 42));
        assert!(!allowed("tab-b", 41));
        assert!(!allowed("tab-a", 0));
        sessions().lock().unwrap().remove("tab-a");
        assert!(!allowed("tab-a", 41));
    }

    #[test]
    fn tab_ids_are_validated() {
        assert!(tab_label("tab-1_x").is_ok());
        assert!(tab_label("../main").is_err());
        assert!(tab_label("").is_err());
    }
}
