//! Hearing sessions: named inputs (the microphone, each person in a call), each through the voice
//! activity detector, what is heard pushed to the window as `misty://speech`.
use std::sync::atomic::Ordering;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use voice_speech::{Hearing, HearingEvent};

use super::super::speech_models;
use super::*;

/// Opens a hearing session for the asking window. What happens is pushed as `misty://speech`:
/// `{ session, input, kind: "started" | "stopped" }`, `{ session, input, kind: "heard", text,
/// start, end, words }`, `{ session, kind: "failed", error }` and, once it is stopped and
/// everything said has been told, `{ session, kind: "closed" }`.
#[tauri::command]
pub async fn speech_hear_start(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechState>,
) -> Result<u64, String> {
    require_person(&webview)?;
    let vad = speech_models::vad_spec().ok_or_else(|| voice_speech::reason("no_model"))?;
    let worker_app = app.clone();
    let recognizer = tokio::task::spawn_blocking(move || {
        let state = worker_app.state::<SpeechState>();
        recognizer(&state)
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))??;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let owner = webview.label().to_string();
    let events_app = app.clone();
    let events_owner = owner.clone();
    let hearing = Hearing::open(recognizer, vad, move |event| {
        let payload = match event {
            HearingEvent::Started { input } => {
                json!({ "session": id, "input": input, "kind": "started" })
            }
            HearingEvent::Stopped { input } => {
                json!({ "session": id, "input": input, "kind": "stopped" })
            }
            HearingEvent::Heard { input, phrase } => json!({
                "session": id,
                "input": input,
                "kind": "heard",
                "text": phrase.text,
                "start": phrase.start,
                "end": phrase.end,
                "words": phrase.words,
            }),
            HearingEvent::Closed => json!({ "session": id, "kind": "closed" }),
        };
        let _ = events_app.emit_to(events_owner.as_str(), SPEECH_EVENT, payload);
    });
    state
        .sessions
        .lock()
        .map_err(|_| voice_speech::reason("failed"))?
        .insert(
            id,
            Session {
                hearing: Arc::new(hearing),
                owner,
                mic: None,
            },
        );
    Ok(id)
}

fn session_hearing(
    state: &SpeechState,
    webview: &Webview,
    session: u64,
) -> Result<Arc<Hearing>, String> {
    let sessions = state.sessions.lock().map_err(|_| voice_speech::reason("failed"))?;
    let found = sessions
        .get(&session)
        .filter(|found| found.owner == webview.label())
        .ok_or_else(|| voice_speech::reason("failed"))?;
    Ok(found.hearing.clone())
}

/// Feeds a session 16 kHz mono PCM16 little-endian samples, as base64, from `input`.
#[tauri::command]
pub async fn speech_hear_push(
    webview: Webview,
    state: State<'_, SpeechState>,
    session: u64,
    input: String,
    pcm: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let hearing = session_hearing(&state, &webview, session)?;
    let bytes = STANDARD
        .decode(pcm.as_bytes())
        .map_err(|_| voice_speech::reason("failed"))?;
    let samples: Vec<f32> = bytes
        .chunks_exact(2)
        .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32768.0)
        .collect();
    tokio::task::spawn_blocking(move || hearing.push(&input, &samples))
        .await
        .map_err(|_| voice_speech::reason("failed"))?
}

/// Has a session hear this computer's microphone directly, as `input`.
#[tauri::command]
pub async fn speech_hear_mic(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechState>,
    session: u64,
    input: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let hearing = session_hearing(&state, &webview, session)?;
    let owner = webview.label().to_string();
    let failed_app = app.clone();
    // The microphone's prompt can wait on the person, so it opens off the async runtime.
    let capture = tokio::task::spawn_blocking(move || {
        let heard_input = input.clone();
        voice_capture::start(
            voice_capture::AudioSource::Mic,
            move |chunk| {
                let samples: Vec<f32> = chunk
                    .samples
                    .iter()
                    .map(|sample| f32::from(*sample) / 32768.0)
                    .collect();
                let _ = hearing.push(&heard_input, &samples);
            },
            move |error| {
                let _ = failed_app.emit_to(
                    owner.as_str(),
                    SPEECH_EVENT,
                    json!({ "session": session, "kind": "failed", "error": error.to_string() }),
                );
            },
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))??;
    let mut sessions = state.sessions.lock().map_err(|_| voice_speech::reason("failed"))?;
    match sessions.get_mut(&session) {
        Some(found) => {
            if let Some(previous) = found.mic.replace(capture) {
                previous.stop();
            }
        }
        None => capture.stop(),
    }
    Ok(())
}

/// Forgets what `input` has said so far, such as Misty's own voice heard through the speakers.
#[tauri::command]
pub fn speech_hear_reset(
    webview: Webview,
    state: State<'_, SpeechState>,
    session: u64,
    input: String,
) -> Result<(), String> {
    require_person(&webview)?;
    session_hearing(&state, &webview, session)?.reset(&input);
    Ok(())
}

/// Stops hearing `input` (someone left the call).
#[tauri::command]
pub fn speech_hear_remove(
    webview: Webview,
    state: State<'_, SpeechState>,
    session: u64,
    input: String,
) -> Result<(), String> {
    require_person(&webview)?;
    session_hearing(&state, &webview, session)?.remove(&input);
    Ok(())
}

/// Ends every hearing session a window opened, as it closes: its microphone stops with it.
pub fn close_window(app: &AppHandle, label: &str) {
    let state = app.state::<SpeechState>();
    let closing: Vec<Session> = match state.sessions.lock() {
        Ok(mut sessions) => {
            let ids: Vec<u64> = sessions
                .iter()
                .filter(|(_, session)| session.owner == label)
                .map(|(id, _)| *id)
                .collect();
            ids.into_iter().filter_map(|id| sessions.remove(&id)).collect()
        }
        Err(_) => return,
    };
    for session in closing {
        if let Some(mic) = session.mic {
            mic.stop();
        }
        session.hearing.close();
    }
}

/// Ends a session: the microphone closes, what each input was saying is recognized and told,
/// then `closed` is pushed.
#[tauri::command]
pub fn speech_hear_stop(
    webview: Webview,
    state: State<'_, SpeechState>,
    session: u64,
) -> Result<(), String> {
    require_person(&webview)?;
    let found = {
        let mut sessions = state.sessions.lock().map_err(|_| voice_speech::reason("failed"))?;
        match sessions.get(&session) {
            Some(found) if found.owner == webview.label() => sessions.remove(&session),
            _ => None,
        }
    };
    if let Some(found) = found {
        if let Some(mic) = found.mic {
            mic.stop();
        }
        found.hearing.close();
    }
    Ok(())
}
