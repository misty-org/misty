//! Speech on this computer through open models from Misty's catalog (`speech_models.rs`), with no
//! key: hearing (sessions over named inputs, such as the person's microphone or each person in a
//! call, whose events are pushed as `misty://speech`), recognizing a recording, and speaking in a
//! voice (one text, or a reading handed over a sentence at a time, whose progress is pushed as
//! `misty://speech-said`). The chat microphone, dictation, recordings, captions, Tutor and agents
//! in calls all hear and speak through here.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{State, Webview};
use voice_speech::{Hearing, Recognizer, Voice};

use super::speech_models;

/// What hearing sessions tell their window.
const SPEECH_EVENT: &str = "misty://speech";
/// How a reading tells its window which sentence it has begun, and when it is over.
const SAID_EVENT: &str = "misty://speech-said";

/// The hearing model and voice in use, as the renderer picked them (`speechModels.ts`).
#[derive(Default)]
struct Chosen {
    hearing: Option<String>,
    voice: Option<String>,
    /// Narrows a model that takes a language (Whisper); none lets it detect.
    language: Option<String>,
    rate: Option<f32>,
}

struct Session {
    hearing: Arc<Hearing>,
    owner: String,
    /// The microphone, when this session hears it directly.
    mic: Option<voice_capture::Capture>,
}

/// A reading: sentences handed over one at a time, spoken in order.
struct Reading {
    id: u64,
    sentences: Sender<Option<String>>,
    stopped: Arc<AtomicBool>,
    finished: Arc<(Mutex<bool>, std::sync::Condvar)>,
}

#[derive(Default)]
pub struct SpeechState {
    next: AtomicU64,
    chosen: Mutex<Chosen>,
    /// The hearing model, opened once, with the id and language it was opened for.
    recognizer: Mutex<Option<(String, Option<String>, Arc<Recognizer>)>>,
    /// Voice models opened so far, by their folder and files: the voices that share one model
    /// (Kokoro's speakers) share it.
    voices: Mutex<HashMap<String, Arc<Voice>>>,
    sessions: Mutex<HashMap<u64, Session>>,
    /// Stops for whatever is being said now.
    playing: Mutex<Vec<Arc<AtomicBool>>>,
    reading: Mutex<Option<Reading>>,
}

pub(super) fn require_person(webview: &Webview) -> Result<(), String> {
    crate::browser::app_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Only Misty's own windows can use speech.".into())
}

/// Sets the hearing model and voice Misty uses, its language and its pace. The renderer calls it
/// at start and whenever the pick changes.
#[tauri::command]
pub fn speech_use(
    webview: Webview,
    state: State<'_, SpeechState>,
    hearing: Option<String>,
    voice: Option<String>,
    language: Option<String>,
    rate: Option<f32>,
) -> Result<(), String> {
    require_person(&webview)?;
    let mut chosen = state.chosen.lock().map_err(|_| voice_speech::reason("failed"))?;
    *chosen = Chosen {
        hearing,
        voice,
        language: language.map(|code| base_language(&code)),
        rate,
    };
    Ok(())
}

/// "en-US" as "en": the models take a language, not a region.
fn base_language(code: &str) -> String {
    code.split(['-', '_']).next().unwrap_or(code).to_ascii_lowercase()
}

#[derive(Debug, Serialize)]
pub struct SpeechSupport {
    /// The hearing model in use is on this computer: microphones and dictation show only then.
    pub recognition: bool,
    /// The voice in use is on this computer.
    pub speaking: bool,
}

/// Whether Misty can hear and speak here now.
#[tauri::command]
pub fn speech_support(webview: Webview, state: State<'_, SpeechState>) -> Result<SpeechSupport, String> {
    require_person(&webview)?;
    let chosen = state.chosen.lock().map_err(|_| voice_speech::reason("failed"))?;
    let recognition = speech_models::vad_spec().is_some()
        && chosen
            .hearing
            .as_deref()
            .is_some_and(|id| speech_models::hearing_spec(id).is_some());
    let speaking = chosen
        .voice
        .as_deref()
        .is_some_and(|id| speech_models::voice_spec(id).is_some());
    Ok(SpeechSupport {
        recognition,
        speaking,
    })
}

/// Forgets an opened model or voice, as it is removed from this computer.
pub(super) fn forget_model(state: &SpeechState, id: &str) {
    if let Ok(mut slot) = state.recognizer.lock() {
        if slot.as_ref().is_some_and(|(open, _, _)| open == id) {
            slot.take();
        }
    }
    if let Some(spec) = speech_models::voice_spec_any(id) {
        if let Ok(mut voices) = state.voices.lock() {
            voices.remove(&voice_key(&spec));
        }
    }
}

/// Which opened model a voice uses: its folder and its files.
fn voice_key(spec: &voice_speech::VoiceSpec) -> String {
    let mut files: Vec<String> = spec
        .files
        .iter()
        .map(|(role, name)| format!("{role}={name}"))
        .collect();
    files.sort();
    format!("{}|{}", spec.dir.display(), files.join(";"))
}

/// The hearing model in use, opened once. Blocking: call it off the async runtime. The model
/// opens outside the lock, which only guards the swap.
fn recognizer(state: &SpeechState) -> Result<Arc<Recognizer>, String> {
    let (id, language) = {
        let chosen = state.chosen.lock().map_err(|_| voice_speech::reason("failed"))?;
        (
            chosen.hearing.clone().ok_or_else(|| voice_speech::reason("no_model"))?,
            chosen.language.clone(),
        )
    };
    {
        let slot = state.recognizer.lock().map_err(|_| voice_speech::reason("failed"))?;
        if let Some((open, open_language, recognizer)) = slot.as_ref() {
            if *open == id && *open_language == language {
                return Ok(recognizer.clone());
            }
        }
    }
    let spec = speech_models::hearing_spec(&id).ok_or_else(|| voice_speech::reason("no_model"))?;
    let recognizer = Arc::new(Recognizer::open(&spec, language.as_deref())?);
    let mut slot = state.recognizer.lock().map_err(|_| voice_speech::reason("failed"))?;
    *slot = Some((id, language, recognizer.clone()));
    Ok(recognizer)
}

/// A voice: its opened model (one per model, shared by its speakers) and its speaker; `id`,
/// else the one in use. Blocking.
fn voice(state: &SpeechState, id: Option<&str>) -> Result<(Arc<Voice>, i32), String> {
    let id = match id {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => state
            .chosen
            .lock()
            .ok()
            .and_then(|chosen| chosen.voice.clone())
            .ok_or_else(|| voice_speech::reason("voice"))?,
    };
    let spec = speech_models::voice_spec(&id).ok_or_else(|| voice_speech::reason("voice"))?;
    let key = voice_key(&spec);
    if let Some(open) = state.voices.lock().ok().and_then(|voices| voices.get(&key).cloned()) {
        return Ok((open, spec.speaker));
    }
    let opened = Arc::new(Voice::open(&spec)?);
    if let Ok(mut voices) = state.voices.lock() {
        voices.insert(key, opened.clone());
    }
    Ok((opened, spec.speaker))
}

fn rate(state: &SpeechState, asked: Option<f32>) -> f32 {
    asked
        .or_else(|| state.chosen.lock().ok().and_then(|chosen| chosen.rate))
        .unwrap_or(1.0)
}

mod hearing;
mod recording;
mod speaking;
pub use hearing::*;
pub use recording::*;
pub use speaking::*;

/// Whether what Misty says is heard only in headphones or earbuds, so the microphone can't pick it
/// up and the person may talk over it. Only macOS says.
pub fn output_private() -> bool {
    #[cfg(target_os = "macos")]
    return core_audio::output_private();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Whether this computer's sound is off (muted, or the volume all the way down), so a spoken
/// answer would go unheard. Only macOS says; elsewhere it's never muted.
#[tauri::command]
pub async fn speech_output_muted(webview: Webview) -> Result<bool, String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    return Ok(core_audio::output_muted());
    #[cfg(not(target_os = "macos"))]
    Ok(false)
}

/// Whether what Misty says is heard only in headphones, so the microphone can't pick it up and
/// the person may talk over it (an agent in a call stops when they do).
#[tauri::command]
pub async fn speech_output_private(webview: Webview) -> Result<bool, String> {
    require_person(&webview)?;
    Ok(output_private())
}

/// Turns the sound back on: unmutes the output, and raises it to half if it was all the way down.
/// Only on macOS; the person asked for it (the muted notice's button).
#[tauri::command]
pub async fn speech_sound_on(webview: Webview) -> Result<(), String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    core_audio::sound_on();
    Ok(())
}

/// Whether another app is using the microphone (a call, a recording) or the screen is being
/// shared, so Misty keeps quiet about things nobody asked for just now. Only macOS says.
#[tauri::command]
pub async fn speech_on_call(webview: Webview) -> Result<bool, String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    return Ok(tokio::task::spawn_blocking(|| {
        core_audio::microphone_busy() || screen_sharing::shared()
    })
    .await
    .unwrap_or(false));
    #[cfg(not(target_os = "macos"))]
    Ok(false)
}

/// Puts an answer on the clipboard, for when it couldn't be heard.
#[tauri::command]
pub async fn speech_copy_answer(webview: Webview, text: String) -> Result<(), String> {
    require_person(&webview)?;
    let text: String = text.chars().take(20_000).collect();
    tokio::task::spawn_blocking(move || {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(text))
            .map_err(|_| "Misty couldn't copy the answer.".to_string())
    })
    .await
    .map_err(|_| "Misty couldn't copy the answer.".to_string())?
}

#[cfg(target_os = "macos")]
mod core_audio;

#[cfg(target_os = "macos")]
mod screen_sharing;
