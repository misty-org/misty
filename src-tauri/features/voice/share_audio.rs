use std::sync::Mutex;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    State, Webview,
};
use voice_capture::Capture;

const CHUNK_SAMPLES: usize = 1_920;

#[derive(Default)]
pub struct ShareAudioState {
    running: Mutex<Option<Capture>>,
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
    if let Some(previous) = running.take() {
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
    *running = Some(capture);
    Ok(())
}

#[tauri::command]
pub fn voice_share_audio_stop(webview: Webview, state: State<'_, ShareAudioState>) {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return;
    }
    if let Ok(mut running) = state.running.lock() {
        if let Some(capture) = running.take() {
            capture.stop();
        }
    }
}
