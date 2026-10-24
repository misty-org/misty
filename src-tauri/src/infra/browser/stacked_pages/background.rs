//! Backgrounding a page that stays stacked while hidden, unless something keeps it running.
use super::*;

/// Backgrounds the stacked page after `background_after`, then keeps checking:
/// a page that starts or stops being exempt, or loads a new document, follows.
pub(super) fn schedule_background(app: &AppHandle, id: &str) {
    let generation = {
        let Ok(mut states) = background_states().lock() else {
            return;
        };
        let state = states.entry(id.to_owned()).or_insert((0, false));
        state.0 += 1;
        state.0
    };
    let app = app.clone();
    let id = id.to_owned();
    tauri::async_runtime::spawn(async move {
        let current = |id: &str| {
            background_states()
                .lock()
                .is_ok_and(|states| states.get(id).is_some_and(|state| state.0 == generation))
        };
        loop {
            let Some(after) = background_after() else {
                return;
            };
            tokio::time::sleep(after).await;
            if !current(&id) {
                return;
            }
            let Some(webview) = app.get_webview(&format!("misty-browser-{id}")) else {
                return;
            };
            if !is_stacked(&webview) {
                return;
            }
            let want = !host_exempt(&app, &id, &webview).await;
            let expression = format!("window.__MISTY_SET_BACKGROUNDED__?.({want}) === true");
            let backgrounded = matches!(
                crate::infra::webview2::evaluate(&webview, expression, None).await,
                Ok(Value::Bool(true))
            );
            if let Ok(mut states) = background_states().lock() {
                if let Some(state) = states.get_mut(&id).filter(|state| state.0 == generation) {
                    state.1 = backgrounded;
                }
            }
        }
    });
}

/// What the host knows keeps a tab running: an agent acting in it, a
/// download it started that is still going, or sound it is playing (Web Audio
/// included). The page itself adds picture in picture and capture.
async fn host_exempt(app: &AppHandle, id: &str, webview: &Webview) -> bool {
    let busy = app.try_state::<BrowserSessionState>().is_some_and(|state| {
        state.sessions.lock().is_ok_and(|sessions| {
            sessions.get(id).is_some_and(|session| {
                agent_controls_page(session)
                    || session
                        .downloads
                        .iter()
                        .any(|download| download.state == "requested")
            })
        })
    });
    if busy {
        return true;
    }
    crate::infra::webview2::with_core(webview, |core, _| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        use windows::core::Interface;
        let mut playing = windows::core::BOOL(0);
        // SAFETY: a live view on its UI thread.
        unsafe {
            core.cast::<ICoreWebView2_8>()
                .and_then(|core| core.IsDocumentPlayingAudio(&mut playing))
        }
        .map_err(|_| crate::infra::webview2::CdpError::Unavailable)?;
        Ok(playing.as_bool())
    })
    .await
    .unwrap_or(true)
}

/// How long a tab stays hidden before it is backgrounded, and how often a
/// stacked tab's exemptions are checked again after that, in seconds. The
/// person chooses it (Settings › Performance); 0 never backgrounds a tab.
static BACKGROUND_AFTER_SECS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn background_after() -> Option<std::time::Duration> {
    match BACKGROUND_AFTER_SECS.load(std::sync::atomic::Ordering::Relaxed) {
        0 => None,
        seconds => Some(std::time::Duration::from_secs(seconds)),
    }
}

/// Sets how long hidden tabs keep drawing (`BACKGROUND_AFTER_SECS`). Pages
/// hidden from now on follow it; a tab already asleep wakes when shown.
#[tauri::command]
pub fn browser_set_hidden_tab_sleep(seconds: u64) {
    BACKGROUND_AFTER_SECS.store(
        seconds.min(24 * 60 * 60),
        std::sync::atomic::Ordering::Relaxed,
    );
}
