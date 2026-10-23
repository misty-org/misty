//! The agent hotkeys while nobody is signed in (docs/browser/no-account.md):
//! the companion chord and the dictation key open the sign-in sheet instead of an agent.
//! They are armed only when Input Monitoring is already granted, so browsing without an
//! account never brings up a permission prompt.
use super::{subscribe, Chord, HotkeyEvent};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

const EVENT: &str = "misty://signed-out-hotkey";

static ARMED: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

fn access_granted() -> bool {
    #[cfg(any(target_os = "macos", windows))]
    return super::platform::access_granted();
    #[cfg(not(any(target_os = "macos", windows)))]
    false
}

/// Listens to one chord until `stop` is set, telling the shell when it is pressed.
fn listen(app: tauri::AppHandle, chord: Chord, stop: Arc<AtomicBool>) {
    let subscription = subscribe(chord);
    while !stop.load(Ordering::SeqCst) {
        match subscription.events.recv_timeout(Duration::from_millis(500)) {
            Ok(HotkeyEvent::Down) => {
                let _ = crate::infra::space_windows::emit_to_primary(&app, EVENT, "agents");
            }
            Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Arms the signed-out agent hotkeys, or disarms them. Arming does nothing without Input
/// Monitoring already granted. Returns whether they are armed.
#[tauri::command]
pub fn global_hotkey_signed_out(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    if !crate::infra::space_windows::is_person_window(webview.label()) {
        return Err("Only Misty's windows can arm hotkeys.".into());
    }
    let mut armed = ARMED.lock().map_err(|_| "Hotkeys are busy.")?;
    if let Some(stop) = armed.take() {
        stop.store(true, Ordering::SeqCst);
    }
    if !enabled || !access_granted() {
        return Ok(false);
    }
    let stop = Arc::new(AtomicBool::new(false));
    for chord in [Chord::companion(), Chord::dictation_default()] {
        let (app, stop) = (app.clone(), stop.clone());
        std::thread::Builder::new()
            .name("misty-signed-out-hotkey".into())
            .spawn(move || listen(app, chord, stop))
            .map_err(|error| error.to_string())?;
    }
    *armed = Some(stop);
    Ok(true)
}
