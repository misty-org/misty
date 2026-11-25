use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Webview};
use tokio::sync::Mutex as AsyncMutex;
use voice_speech::Speech;

use crate::apps::app_server;

pub const APP_ID: &str = "voicebox";
const ENGINE: &str = "qwen_custom_voice";
const MODEL: &str = "qwen-custom-voice-0.6B";
const KEY_PREFIX: &str = "qwen-";
pub const DEFAULT_VOICE: &str = "qwen-ryan";
const RATE: u32 = 24_000;
const CLIENT_ID: &str = "misty";
const MODEL_EVENT: &str = "misty://voicebox-model";
const LANGUAGES: [&str; 22] = [
    "zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "he", "ar", "da", "el", "fi", "hi",
    "ms", "nl", "no", "pl", "sv", "sw",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOption {
    pub key: String,
    pub name: String,
    pub gender: String,
    pub language: String,
}

#[derive(Deserialize)]
struct Presets {
    #[serde(default)]
    voices: Vec<Preset>,
}

#[derive(Deserialize)]
struct Preset {
    voice_id: String,
    name: String,
    #[serde(default)]
    gender: String,
    #[serde(default)]
    language: String,
}

#[derive(Deserialize)]
struct Profile {
    id: String,
    #[serde(default)]
    voice_type: Option<String>,
    #[serde(default)]
    preset_engine: Option<String>,
    #[serde(default)]
    preset_voice_id: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Deserialize)]
struct ModelStatus {
    model_name: String,
    #[serde(default)]
    downloaded: bool,
}

#[derive(Deserialize)]
struct ModelStatuses {
    #[serde(default)]
    models: Vec<ModelStatus>,
}

#[derive(Deserialize)]
struct DownloadProgress {
    #[serde(default)]
    status: String,
    #[serde(default)]
    progress: Option<f64>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct ModelProgress {
    status: String,
    progress: f64,
}

static PROFILES: LazyLock<Mutex<HashMap<(String, String), String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static MODEL_READY: LazyLock<AsyncMutex<bool>> = LazyLock::new(|| AsyncMutex::new(false));

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let builder = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(10));
    let builder = match timeout {
        Some(timeout) => builder.timeout(timeout),
        None => builder,
    };
    builder.build().map_err(|error| error.to_string())
}

fn unreachable_server(_: reqwest::Error) -> String {
    "Voicebox didn't answer. Try again in a moment.".into()
}

async fn answer_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    body.pointer("/error/message")
        .or_else(|| body.get("detail"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("Voicebox answered {status}."))
}

pub fn usable() -> bool {
    app_server::runs_here(APP_ID) && app_server::installed(APP_ID)
}

fn language_of(language: Option<&str>) -> String {
    language
        .map(|code| code.split(['-', '_']).next().unwrap_or(code).to_ascii_lowercase())
        .filter(|code| LANGUAGES.contains(&code.as_str()))
        .unwrap_or_else(|| "en".to_owned())
}

fn key_of(voice_id: &str) -> String {
    let slug: String = voice_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    format!("{KEY_PREFIX}{slug}")
}

fn preset_of(key: &str) -> Result<&str, String> {
    key.strip_prefix(KEY_PREFIX)
        .filter(|slug| !slug.is_empty())
        .ok_or_else(|| "That isn't one of Voicebox's voices.".to_owned())
}

static PRESETS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

async fn presets(url: &str) -> Result<Vec<Preset>, String> {
    let response = client(Some(Duration::from_secs(30)))?
        .get(format!("{url}/profiles/presets/{ENGINE}"))
        .send()
        .await
        .map_err(unreachable_server)?;
    if !response.status().is_success() {
        return Err(answer_error(response).await);
    }
    let presets: Presets = response.json().await.map_err(|error| error.to_string())?;
    if let Ok(mut known) = PRESETS.lock() {
        for preset in &presets.voices {
            known.insert(key_of(&preset.voice_id), preset.voice_id.clone());
        }
    }
    Ok(presets.voices)
}

pub async fn voices(app: &AppHandle) -> Result<Vec<VoiceOption>, String> {
    let url = app_server::url(app, APP_ID).await?;
    Ok(presets(&url)
        .await?
        .into_iter()
        .map(|preset| VoiceOption {
            key: key_of(&preset.voice_id),
            name: preset.name,
            gender: preset.gender,
            language: preset.language,
        })
        .collect())
}

async fn preset_id(url: &str, key: &str) -> Result<String, String> {
    preset_of(key)?;
    let known = |key: &str| PRESETS.lock().ok().and_then(|known| known.get(key).cloned());
    if let Some(id) = known(key) {
        return Ok(id);
    }
    presets(url).await?;
    known(key).ok_or_else(|| "That isn't one of Voicebox's voices.".to_owned())
}

async fn profile(url: &str, key: &str, language: &str) -> Result<String, String> {
    let cache_key = (key.to_owned(), language.to_owned());
    if let Some(id) = PROFILES
        .lock()
        .ok()
        .and_then(|profiles| profiles.get(&cache_key).cloned())
    {
        return Ok(id);
    }
    let voice = preset_id(url, key).await?;
    let voice = voice.as_str();
    let http = client(Some(Duration::from_secs(30)))?;
    let listed = http
        .get(format!("{url}/profiles"))
        .send()
        .await
        .map_err(unreachable_server)?;
    if !listed.status().is_success() {
        return Err(answer_error(listed).await);
    }
    let profiles: Vec<Profile> = listed.json().await.map_err(|error| error.to_string())?;
    let found = profiles.into_iter().find(|profile| {
        profile.voice_type.as_deref() == Some("preset")
            && profile.preset_engine.as_deref() == Some(ENGINE)
            && profile.preset_voice_id.as_deref() == Some(voice)
            && profile.language.as_deref() == Some(language)
    });
    let id = match found {
        Some(profile) => profile.id,
        None => {
            let made = http
                .post(format!("{url}/profiles"))
                .json(&json!({
                    "name": format!("Misty {voice} {language}"),
                    "language": language,
                    "voice_type": "preset",
                    "preset_engine": ENGINE,
                    "preset_voice_id": voice,
                    "default_engine": ENGINE,
                }))
                .send()
                .await
                .map_err(unreachable_server)?;
            if !made.status().is_success() {
                return Err(answer_error(made).await);
            }
            made.json::<Profile>()
                .await
                .map_err(|error| error.to_string())?
                .id
        }
    };
    if let Ok(mut profiles) = PROFILES.lock() {
        profiles.insert(cache_key, id.clone());
    }
    Ok(id)
}

async fn model_downloaded(url: &str) -> Result<bool, String> {
    let response = client(Some(Duration::from_secs(30)))?
        .get(format!("{url}/models/status"))
        .send()
        .await
        .map_err(unreachable_server)?;
    if !response.status().is_success() {
        return Err(answer_error(response).await);
    }
    let statuses: ModelStatuses = response.json().await.map_err(|error| error.to_string())?;
    Ok(statuses
        .models
        .iter()
        .any(|model| model.model_name == MODEL && model.downloaded))
}

async fn ensure_model(app: &AppHandle, url: &str) -> Result<(), String> {
    let mut ready = MODEL_READY.lock().await;
    if *ready {
        return Ok(());
    }
    if model_downloaded(url).await? {
        *ready = true;
        return Ok(());
    }
    let mut progress = client(Some(Duration::from_secs(60 * 60)))?
        .get(format!("{url}/models/progress/{MODEL}"))
        .send()
        .await
        .map_err(unreachable_server)?;
    let started = client(Some(Duration::from_secs(30)))?
        .post(format!("{url}/models/download"))
        .json(&json!({ "model_name": MODEL }))
        .send()
        .await
        .map_err(unreachable_server)?;
    if !started.status().is_success() {
        return Err(answer_error(started).await);
    }
    let mut pending = String::new();
    while let Some(chunk) = progress.chunk().await.map_err(unreachable_server)? {
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = pending.find("\n\n") {
            let event: String = pending.drain(..end + 2).collect();
            let Some(data) = event
                .lines()
                .find_map(|line| line.strip_prefix("data:"))
                .map(str::trim)
            else {
                continue;
            };
            let Ok(update) = serde_json::from_str::<DownloadProgress>(data) else {
                continue;
            };
            let _ = app.emit(
                MODEL_EVENT,
                ModelProgress {
                    status: update.status.clone(),
                    progress: update.progress.unwrap_or(0.0),
                },
            );
            match update.status.as_str() {
                "complete" => {
                    *ready = true;
                    return Ok(());
                }
                "error" => {
                    return Err(update
                        .error
                        .unwrap_or_else(|| "Voicebox couldn't download its voice.".to_owned()))
                }
                _ => {}
            }
        }
    }
    if model_downloaded(url).await? {
        *ready = true;
        return Ok(());
    }
    Err("Voicebox couldn't download its voice.".into())
}

pub async fn warm(app: &AppHandle) -> Result<(), String> {
    let url = app_server::url(app, APP_ID).await?;
    ensure_model(app, &url).await?;
    let response = client(Some(Duration::from_secs(5 * 60)))?
        .post(format!("{url}/models/load"))
        .json(&json!({ "model_name": MODEL }))
        .send()
        .await
        .map_err(unreachable_server)?;
    if !response.status().is_success() {
        return Err(answer_error(response).await);
    }
    Ok(())
}

pub async fn speak(
    app: &AppHandle,
    text: &str,
    voice: Option<&str>,
    language: Option<&str>,
    speed: f32,
) -> Result<Speech, String> {
    if !usable() {
        return Err("Voicebox isn't on this computer. Get it in Explore to hear Misty.".into());
    }
    let url = app_server::url(app, APP_ID).await?;
    ensure_model(app, &url).await?;
    let key = voice
        .filter(|key| key.starts_with(KEY_PREFIX))
        .unwrap_or(DEFAULT_VOICE);
    let language = language_of(language);
    let profile = profile(&url, key, &language).await?;
    let response = client(Some(Duration::from_secs(5 * 60)))?
        .post(format!("{url}/v1/audio/speech"))
        .header("X-Voicebox-Client-Id", CLIENT_ID)
        .json(&json!({
            "model": MODEL,
            "input": text,
            "voice": profile,
            "response_format": "pcm",
            "speed": speed.clamp(0.25, 4.0),
        }))
        .send()
        .await
        .map_err(unreachable_server)?;
    if !response.status().is_success() {
        return Err(answer_error(response).await);
    }
    let bytes = response.bytes().await.map_err(unreachable_server)?;
    let samples = bytes
        .chunks_exact(2)
        .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32768.0)
        .collect();
    Ok(Speech {
        samples,
        rate: RATE,
    })
}

pub struct Speaker {
    app: AppHandle,
    voice: Option<String>,
    language: Option<String>,
}

impl Speaker {
    pub fn new(app: &AppHandle, voice: Option<String>, language: Option<String>) -> Result<Self, String> {
        if !usable() {
            return Err("Voicebox isn't on this computer. Get it in Explore to hear Misty.".into());
        }
        Ok(Self {
            app: app.clone(),
            voice,
            language,
        })
    }

    pub fn voice(&self) -> Option<&str> {
        self.voice.as_deref()
    }

    pub fn speak(&self, text: &str, speed: f32) -> Result<Speech, String> {
        tauri::async_runtime::block_on(speak(
            &self.app,
            text,
            self.voice.as_deref(),
            self.language.as_deref(),
            speed,
        ))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceboxState {
    runs_here: bool,
    installed: bool,
}

#[tauri::command]
pub fn voicebox_state(webview: Webview) -> Result<VoiceboxState, String> {
    super::speech::require_person(&webview)?;
    Ok(VoiceboxState {
        runs_here: app_server::runs_here(APP_ID),
        installed: usable(),
    })
}

#[tauri::command]
pub async fn voicebox_voices(app: AppHandle, webview: Webview) -> Result<Vec<VoiceOption>, String> {
    super::speech::require_person(&webview)?;
    voices(&app).await
}

#[tauri::command]
pub async fn voicebox_warm(app: AppHandle, webview: Webview) -> Result<(), String> {
    super::speech::require_person(&webview)?;
    warm(&app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_voice_key_names_one_of_voiceboxs_presets() {
        assert_eq!(key_of("Uncle_Fu"), "qwen-uncle-fu");
        assert_eq!(preset_of("qwen-ryan"), Ok("ryan"));
        assert!(preset_of("kokoro-heart").is_err());
        assert!(preset_of("qwen-").is_err());
    }

    #[test]
    fn a_language_voicebox_lacks_speaks_english() {
        assert_eq!(language_of(Some("en-US")), "en");
        assert_eq!(language_of(Some("ja")), "ja");
        assert_eq!(language_of(Some("auto")), "en");
        assert_eq!(language_of(None), "en");
    }
}
