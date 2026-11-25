use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{State, Webview};
use voice_speech::{Hearing, Recognizer};

use super::speech_models;

const SPEECH_EVENT: &str = "misty://speech";
const SAID_EVENT: &str = "misty://speech-said";

#[cfg(target_os = "macos")]
const HELPER_PROFILE: &str = r#"
(version 1)
(allow default)
(deny process-exec)
(allow process-exec (literal (param "TOOL")))
(deny network*)
"#;

pub fn helper_command() -> Result<std::process::Command, String> {
    let program = crate::app::workers::program("speech")?;
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new(sandbox::macos::SANDBOX_EXEC);
        command
            .args(sandbox::macos::arguments(
                HELPER_PROFILE,
                &[("TOOL", program.as_path())],
            ))
            .arg(&program);
        Ok(command)
    }
    #[cfg(not(target_os = "macos"))]
    Ok(std::process::Command::new(program))
}

#[derive(Default)]
struct Chosen {
    hearing: Option<String>,
    voice: Option<String>,
    language: Option<String>,
    rate: Option<f32>,
}

struct Session {
    hearing: Arc<Hearing>,
    owner: String,
    mic: Option<voice_capture::Capture>,
}

struct Reading {
    id: u64,
    sentences: Sender<Option<String>>,
    stopped: Arc<AtomicBool>,
    finished: Arc<(Mutex<bool>, std::sync::Condvar)>,
}

type OpenRecognizer = (String, Option<String>, Arc<Recognizer>);

#[derive(Default)]
pub struct SpeechState {
    next: AtomicU64,
    chosen: Mutex<Chosen>,
    recognizer: Mutex<Option<OpenRecognizer>>,
    sessions: Mutex<HashMap<u64, Session>>,
    playing: Mutex<Vec<Arc<AtomicBool>>>,
    reading: Mutex<Option<Reading>>,
    output: Mutex<Option<String>>,
}

pub(super) fn require_person(webview: &Webview) -> Result<(), String> {
    crate::browser::app_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Only Misty's own windows can use speech.".into())
}

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
    let mut chosen = state
        .chosen
        .lock()
        .map_err(|_| voice_speech::reason("failed"))?;
    *chosen = Chosen {
        hearing,
        voice,
        language: language.map(|code| base_language(&code)),
        rate,
    };
    Ok(())
}

fn base_language(code: &str) -> String {
    code.split(['-', '_'])
        .next()
        .unwrap_or(code)
        .to_ascii_lowercase()
}

#[derive(Debug, Serialize)]
pub struct SpeechSupport {
    pub recognition: bool,
    pub speaking: bool,
}

#[tauri::command]
pub fn speech_support(
    webview: Webview,
    state: State<'_, SpeechState>,
) -> Result<SpeechSupport, String> {
    require_person(&webview)?;
    let chosen = state
        .chosen
        .lock()
        .map_err(|_| voice_speech::reason("failed"))?;
    let recognition = speech_models::vad_spec().is_some()
        && chosen
            .hearing
            .as_deref()
            .is_some_and(|id| speech_models::hearing_spec(id).is_some());
    let speaking = super::voicebox::usable();
    Ok(SpeechSupport {
        recognition,
        speaking,
    })
}

pub(super) fn forget_model(state: &SpeechState, id: &str) {
    if let Ok(mut slot) = state.recognizer.lock() {
        if slot.as_ref().is_some_and(|(open, _, _)| open == id) {
            slot.take();
        }
    }
}

fn recognizer(state: &SpeechState) -> Result<Arc<Recognizer>, String> {
    let (id, language) = {
        let chosen = state
            .chosen
            .lock()
            .map_err(|_| voice_speech::reason("failed"))?;
        (
            chosen
                .hearing
                .clone()
                .ok_or_else(|| voice_speech::reason("no_model"))?,
            chosen.language.clone(),
        )
    };
    {
        let slot = state
            .recognizer
            .lock()
            .map_err(|_| voice_speech::reason("failed"))?;
        if let Some((open, open_language, recognizer)) = slot.as_ref() {
            if *open == id && *open_language == language {
                return Ok(recognizer.clone());
            }
        }
    }
    let spec = speech_models::hearing_spec(&id).ok_or_else(|| voice_speech::reason("no_model"))?;
    let recognizer = Arc::new(Recognizer::open(&spec, language.as_deref())?);
    let mut slot = state
        .recognizer
        .lock()
        .map_err(|_| voice_speech::reason("failed"))?;
    *slot = Some((id, language, recognizer.clone()));
    Ok(recognizer)
}

fn speaker(
    app: &tauri::AppHandle,
    state: &SpeechState,
    id: Option<&str>,
) -> Result<super::voicebox::Speaker, String> {
    let (chosen_voice, language) = state
        .chosen
        .lock()
        .map(|chosen| (chosen.voice.clone(), chosen.language.clone()))
        .unwrap_or_default();
    let voice = id
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .or(chosen_voice);
    super::voicebox::Speaker::new(app, voice, language)
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

pub fn output_private() -> bool {
    #[cfg(target_os = "macos")]
    return core_audio::output_private();
    #[cfg(not(target_os = "macos"))]
    false
}

#[tauri::command]
pub fn speech_output_device(
    webview: Webview,
    state: State<'_, SpeechState>,
    name: Option<String>,
) -> Result<(), String> {
    require_person(&webview)?;
    let name = name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    *state
        .output
        .lock()
        .map_err(|_| voice_speech::reason("failed"))? = name;
    Ok(())
}

impl SpeechState {
    pub(super) fn output(&self) -> Option<String> {
        self.output.lock().ok().and_then(|output| output.clone())
    }
}

#[tauri::command]
pub async fn speech_output_muted(webview: Webview) -> Result<bool, String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    return Ok(core_audio::output_muted());
    #[cfg(not(target_os = "macos"))]
    Ok(false)
}

#[tauri::command]
pub async fn speech_output_private(webview: Webview) -> Result<bool, String> {
    require_person(&webview)?;
    Ok(output_private())
}

#[tauri::command]
pub async fn speech_sound_on(webview: Webview) -> Result<(), String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    core_audio::sound_on();
    Ok(())
}

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
