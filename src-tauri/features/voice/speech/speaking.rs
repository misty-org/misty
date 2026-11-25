use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use voice_speech::Speech;

use super::super::voicebox::Speaker;
use super::*;

fn play_and_wait(
    speech: Speech,
    stopped: &Arc<AtomicBool>,
    output: Option<String>,
) -> Result<(), String> {
    if stopped.load(Ordering::SeqCst) {
        return Ok(());
    }
    voice_speech::play(speech, stopped.clone(), output).wait()
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
    if text.trim().is_empty() || !super::super::voicebox::usable() {
        return Ok(());
    }
    stop_speaking(&state);
    let stopped = Arc::new(AtomicBool::new(false));
    if let Ok(mut playing) = state.playing.lock() {
        playing.push(stopped.clone());
    }
    tokio::task::spawn_blocking(move || {
        let state = app.state::<SpeechState>();
        let speed = self::rate(&state, rate);
        let opened = self::speaker(&app, &state, voice.as_deref());
        let mut result = Ok(());
        for sentence in sentences(&text) {
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            let spoken = match opened.as_ref() {
                Ok(speaker) => speaker.speak(&sentence, speed),
                Err(error) => Err(error.clone()),
            };
            match spoken {
                Ok(speech) => {
                    if let Err(error) = play_and_wait(speech, &stopped, state.output()) {
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

fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for character in text.chars() {
        current.push(character);
        if matches!(character, '.' | '!' | '?' | '。' | '！' | '？' | '\n')
            && current.trim().len() > 1
        {
            out.push(std::mem::take(&mut current).trim().to_string());
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out.retain(|sentence| !sentence.is_empty());
    out
}

#[tauri::command]
pub fn speech_stop(webview: Webview, state: State<'_, SpeechState>) -> Result<(), String> {
    require_person(&webview)?;
    stop_speaking(&state);
    Ok(())
}

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

    let maker_app = app.clone();
    let maker_stopped = stopped.clone();
    std::thread::spawn(move || {
        let state = maker_app.state::<SpeechState>();
        let speed = self::rate(&state, rate);
        let opened = self::speaker(&maker_app, &state, voice.as_deref());
        for (index, sentence) in queue.into_iter().enumerate() {
            let Some(sentence) = sentence else { break };
            if maker_stopped.load(Ordering::SeqCst) {
                break;
            }
            let Ok(speaker) = opened.as_ref() else {
                break;
            };
            if let Ok(speech) = speaker.speak(&sentence, speed) {
                if made.send(Some((index, speech))).is_err() {
                    break;
                }
            }
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
            if play_and_wait(speech, &player_stopped, state.output()).is_err() {
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
        let _ = player_app.emit_to(
            owner.as_str(),
            SAID_EVENT,
            json!({ "reading": id, "done": true }),
        );
        let (lock, wake) = &*player_finished;
        if let Ok(mut done) = lock.lock() {
            *done = true;
            wake.notify_all();
        }
    });

    *state
        .reading
        .lock()
        .map_err(|_| voice_speech::reason("failed"))? = Some(Reading {
        id,
        sentences,
        stopped,
        finished,
    });
    Ok(id)
}

#[tauri::command]
pub fn speech_reading_add(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
    text: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let open = state
        .reading
        .lock()
        .map_err(|_| voice_speech::reason("failed"))?;
    if let Some(open) = open.as_ref().filter(|open| open.id == reading) {
        let text: String = text.chars().take(4_000).collect();
        if !text.trim().is_empty() {
            let _ = open.sentences.send(Some(text));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn speech_reading_end(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
) -> Result<(), String> {
    require_person(&webview)?;
    let finished = {
        let open = state
            .reading
            .lock()
            .map_err(|_| voice_speech::reason("failed"))?;
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
            done = wake
                .wait(done)
                .map_err(|_| voice_speech::reason("failed"))?;
        }
        Ok(())
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))?
}

#[derive(Serialize)]
pub struct Rendered {
    pcm: String,
    rate: u32,
}

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
        let speech = self::speaker(&app, &state, voice.as_deref())?.speak(&text, speed)?;
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

pub fn dialogue_voices(app: &AppHandle, first: Option<&str>) -> Result<Vec<Speaker>, String> {
    let state = app.state::<SpeechState>();
    let opened = speaker(app, &state, first)?;
    let second = if opened.voice() == Some(SECOND_VOICE) {
        FIRST_VOICE
    } else {
        SECOND_VOICE
    };
    let other = speaker(app, &state, Some(second))?;
    Ok(vec![opened, other])
}

const FIRST_VOICE: &str = "qwen-ryan";
const SECOND_VOICE: &str = "qwen-serena";

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
