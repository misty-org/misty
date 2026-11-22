//! Speaking: one text, a reading handed over a sentence at a time (`misty://speech-said`), a
//! voice's preview, an agent's answer rendered for a call, and an audio overview's two voices.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use voice_speech::{Speech, Voice};

use super::super::speech_models;
use super::*;

/// Plays `speech` until it has been played or `stopped` is set; returns once it ended. Blocking.
/// The caller registers `stopped` in `playing`, so `speech_stop` reaches it.
fn play_and_wait(speech: Speech, stopped: &Arc<AtomicBool>) -> Result<(), String> {
    if stopped.load(Ordering::SeqCst) {
        return Ok(());
    }
    voice_speech::play(speech, stopped.clone()).wait()
}

fn stop_speaking(state: &SpeechState) {
    if let Ok(playing) = state.playing.lock() {
        for flag in playing.iter() {
            flag.store(true, Ordering::SeqCst);
        }
    }
    if let Ok(mut reading) = state.reading.lock() {
        if let Some(reading) = reading.take() {
            reading.stopped.store(true, Ordering::SeqCst);
            let _ = reading.sentences.send(None);
        }
    }
}

/// Says `text` aloud in `voice` (a catalog id; the one in use when left out) at `rate`. Stops
/// anything already being said, and answers once it has been said or was stopped.
#[tauri::command]
pub async fn speech_say(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechState>,
    text: String,
    voice: Option<String>,
    rate: Option<f32>,
) -> Result<(), String> {
    require_person(&webview)?;
    let text: String = text.chars().take(20_000).collect();
    if text.trim().is_empty() {
        return Ok(());
    }
    stop_speaking(&state);
    // Registered before the voice opens, so a stop while it opens still reaches it.
    let stopped = Arc::new(AtomicBool::new(false));
    if let Ok(mut playing) = state.playing.lock() {
        playing.push(stopped.clone());
    }
    tokio::task::spawn_blocking(move || {
        let state = app.state::<SpeechState>();
        let speed = self::rate(&state, rate);
        let opened = self::voice(&state, voice.as_deref());
        let mut result = Ok(());
        for sentence in sentences(&text) {
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            let spoken = match opened.as_ref() {
                Ok((model, speaker)) => model.speak(&sentence, *speaker, speed),
                Err(error) => Err(error.clone()),
            };
            match spoken {
                Ok(speech) => {
                    if let Err(error) = play_and_wait(speech, &stopped) {
                        result = Err(error);
                        break;
                    }
                }
                Err(error) => {
                    result = Err(error);
                    break;
                }
            }
        }
        if let Ok(mut playing) = state.playing.lock() {
            playing.retain(|flag| !Arc::ptr_eq(flag, &stopped));
        }
        result
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))?
}

/// A long text in sentences, so speech starts before all of it has been made.
fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for character in text.chars() {
        current.push(character);
        if matches!(character, '.' | '!' | '?' | '。' | '！' | '？' | '\n') && current.trim().len() > 1 {
            out.push(std::mem::take(&mut current).trim().to_string());
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out.retain(|sentence| !sentence.is_empty());
    out
}

/// Stops whatever Misty is saying.
#[tauri::command]
pub fn speech_stop(webview: Webview, state: State<'_, SpeechState>) -> Result<(), String> {
    require_person(&webview)?;
    stop_speaking(&state);
    Ok(())
}

/// Opens a reading: sentences handed over with `speech_reading_add` are spoken in order as they
/// arrive, in `voice` (the one in use when left out). As each begins, `misty://speech-said`
/// pushes `{ reading, index }`; once all are said, or it was stopped, `{ reading, done: true }`.
/// Anything else said stops it.
#[tauri::command]
pub fn speech_reading_start(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechState>,
    voice: Option<String>,
    rate: Option<f32>,
) -> Result<u64, String> {
    require_person(&webview)?;
    stop_speaking(&state);
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (sentences, queue) = channel::<Option<String>>();
    let stopped = Arc::new(AtomicBool::new(false));
    let finished = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let owner = webview.label().to_string();
    let (made, ready) = channel::<Option<(usize, Speech)>>();

    // Speech is made ahead of what is playing, so one sentence follows the next without a gap.
    let maker_app = app.clone();
    let maker_stopped = stopped.clone();
    std::thread::spawn(move || {
        let state = maker_app.state::<SpeechState>();
        let speed = self::rate(&state, rate);
        let opened = self::voice(&state, voice.as_deref());
        let mut index = 0;
        for sentence in queue {
            let Some(sentence) = sentence else { break };
            if maker_stopped.load(Ordering::SeqCst) {
                break;
            }
            let Ok((model, speaker)) = opened.as_ref() else { break };
            if let Ok(speech) = model.speak(&sentence, *speaker, speed) {
                if made.send(Some((index, speech))).is_err() {
                    break;
                }
            }
            index += 1;
        }
        let _ = made.send(None);
    });

    let player_app = app.clone();
    let player_stopped = stopped.clone();
    let player_finished = finished.clone();
    if let Ok(mut playing) = state.playing.lock() {
        playing.push(stopped.clone());
    }
    std::thread::spawn(move || {
        let state = player_app.state::<SpeechState>();
        for next in ready {
            let Some((index, speech)) = next else { break };
            if player_stopped.load(Ordering::SeqCst) {
                break;
            }
            let _ = player_app.emit_to(
                owner.as_str(),
                SAID_EVENT,
                json!({ "reading": id, "index": index }),
            );
            if play_and_wait(speech, &player_stopped).is_err() {
                break;
            }
        }
        if let Ok(mut playing) = state.playing.lock() {
            playing.retain(|flag| !Arc::ptr_eq(flag, &player_stopped));
        }
        if let Ok(mut reading) = state.reading.lock() {
            if reading.as_ref().is_some_and(|open| open.id == id) {
                reading.take();
            }
        }
        let _ = player_app.emit_to(owner.as_str(), SAID_EVENT, json!({ "reading": id, "done": true }));
        let (lock, wake) = &*player_finished;
        if let Ok(mut done) = lock.lock() {
            *done = true;
            wake.notify_all();
        }
    });

    *state.reading.lock().map_err(|_| voice_speech::reason("failed"))? = Some(Reading {
        id,
        sentences,
        stopped,
        finished,
    });
    Ok(id)
}

/// Hands a reading its next sentence.
#[tauri::command]
pub fn speech_reading_add(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
    text: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let open = state.reading.lock().map_err(|_| voice_speech::reason("failed"))?;
    if let Some(open) = open.as_ref().filter(|open| open.id == reading) {
        let text: String = text.chars().take(4_000).collect();
        if !text.trim().is_empty() {
            let _ = open.sentences.send(Some(text));
        }
    }
    Ok(())
}

/// Says a reading has no more sentences; answers once all of them have been said, or it was
/// stopped.
#[tauri::command]
pub async fn speech_reading_end(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
) -> Result<(), String> {
    require_person(&webview)?;
    let finished = {
        let open = state.reading.lock().map_err(|_| voice_speech::reason("failed"))?;
        match open.as_ref().filter(|open| open.id == reading) {
            Some(open) => {
                let _ = open.sentences.send(None);
                open.finished.clone()
            }
            None => return Ok(()),
        }
    };
    tokio::task::spawn_blocking(move || {
        let (lock, wake) = &*finished;
        let mut done = lock.lock().map_err(|_| voice_speech::reason("failed"))?;
        while !*done {
            done = wake.wait(done).map_err(|_| voice_speech::reason("failed"))?;
        }
        Ok(())
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))?
}

#[derive(Serialize)]
pub struct Rendered {
    /// Mono PCM16 little-endian, as base64.
    pcm: String,
    rate: u32,
}

/// Speaks `text` in `voice` without playing it, for an agent's answer published into a call as
/// its own audio track.
#[tauri::command]
pub async fn speech_render(
    app: AppHandle,
    webview: Webview,
    text: String,
    voice: Option<String>,
    rate: Option<f32>,
) -> Result<Rendered, String> {
    require_person(&webview)?;
    let text: String = text.chars().take(4_000).collect();
    tokio::task::spawn_blocking(move || {
        let state = app.state::<SpeechState>();
        let speed = self::rate(&state, rate);
        let (model, speaker) = self::voice(&state, voice.as_deref())?;
        let speech = model.speak(&text, speaker, speed)?;
        let bytes: Vec<u8> = speech
            .samples
            .iter()
            .flat_map(|sample| ((sample.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
            .collect();
        Ok(Rendered {
            pcm: STANDARD.encode(bytes),
            rate: speech.rate,
        })
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))?
}

/// The two voices of an audio overview: `first` (a catalog id; the one in use when left out),
/// then another voice on this computer that speaks its language, of the other gender where there
/// is one. With no other, the first speaks both parts. Blocking.
pub fn dialogue_voices(
    app: &AppHandle,
    first: Option<&str>,
) -> Result<Vec<(Arc<Voice>, i32)>, String> {
    let state = app.state::<SpeechState>();
    let first_id = match first.filter(|id| !id.trim().is_empty()) {
        Some(id) => id.to_string(),
        None => state
            .chosen
            .lock()
            .ok()
            .and_then(|chosen| chosen.voice.clone())
            .ok_or_else(|| voice_speech::reason("voice"))?,
    };
    let opened = voice(&state, Some(first_id.as_str()))?;
    let mut voices = vec![opened];
    if let Some(entry) = speech_models::voice(&first_id) {
        let others: Vec<_> = speech_models::installed_voices()
            .into_iter()
            .filter(|other| other.id != entry.id)
            .filter(|other| other.languages.iter().any(|code| entry.languages.contains(code)))
            .collect();
        let second = others
            .iter()
            .find(|other| other.gender != entry.gender)
            .or_else(|| others.first());
        if let Some(second) = second {
            if let Ok(other) = voice(&state, Some(second.id.as_str())) {
                voices.push(other);
            }
        }
    }
    Ok(voices)
}

/// Says a voice's sample sentence, for picking one (an agent's voice, Misty's own).
#[tauri::command]
pub async fn speech_preview(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechState>,
    voice: String,
    text: String,
) -> Result<(), String> {
    speech_say(app, webview, state, text, Some(voice), None).await
}
