use std::sync::Mutex;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager, State, Webview,
};
use voice_capture::Capture;

const CHUNK_SAMPLES: usize = 1_920;

#[derive(Default)]
pub struct ShareAudioState {
    running: Mutex<Option<(String, Capture)>>,
}

#[tauri::command]
pub async fn voice_share_audio_start(
    webview: Webview,
    state: State<'_, ShareAudioState>,
    audio: Channel<InvokeResponseBody>,
    ended: Channel<String>,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Main Misty window required.".into());
    }
    let mut running = state.running.lock().map_err(|_| "Capture is busy.")?;
    if let Some((_, previous)) = running.take() {
        previous.stop();
    }
    let pending = Mutex::new(Vec::<u8>::with_capacity(CHUNK_SAMPLES * 2));
    let capture = voice_capture::start_share(
        move |chunk| {
            let Ok(mut pending) = pending.lock() else {
                return;
            };
            pending.extend(chunk.samples.iter().flat_map(|sample| sample.to_le_bytes()));
            if pending.len() >= CHUNK_SAMPLES * 2 {
                let bytes = std::mem::replace(&mut *pending, Vec::with_capacity(CHUNK_SAMPLES * 2));
                let _ = audio.send(InvokeResponseBody::Raw(bytes));
            }
        },
        move |error| {
            let _ = ended.send(error.to_string());
        },
    )
    .map_err(|error| error.to_string())?;
    *running = Some((webview.label().to_owned(), capture));
    Ok(())
}

#[tauri::command]
pub fn voice_share_audio_stop(webview: Webview, state: State<'_, ShareAudioState>) {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return;
    }
    stop_owned_by(&state, webview.label());
}

fn stop_owned_by(state: &ShareAudioState, label: &str) {
    let Ok(mut running) = state.running.lock() else {
        return;
    };
    if running.as_ref().is_some_and(|(owner, _)| owner == label) {
        if let Some((_, capture)) = running.take() {
            capture.stop();
        }
    }
}

pub fn close_share_audio_window(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<ShareAudioState>() {
        stop_owned_by(&state, label);
    }
}
