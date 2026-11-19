//! Speech on this computer, with no key: recognizing what the person says (a recorded file, or
//! the microphone live, through `voice_speech`) and speaking aloud in a system voice (`say` on
//! macOS, the built-in speech engine on Windows, `espeak-ng` on Linux). The chat microphone,
//! dictation, recordings and Tutor all hear and speak through here.
use serde::Serialize;
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, Webview};

/// A live listen's partial and final words, sent to the window that started it.
const HEARD_EVENT: &str = "misty://speech-heard";
/// How often a live listen reports what it has heard.
const POLL: Duration = Duration::from_millis(120);

#[derive(Default)]
pub struct SpeechState {
    session: AtomicU64,
    listening: Mutex<Option<Listen>>,
    speaking: Mutex<Option<tokio::process::Child>>,
    /// Sentences being read aloud as they're handed over (`speech_reading_*`).
    reading: Mutex<Option<Reading>>,
    /// Fed streams (a capture's channels), by id.
    streams: Mutex<std::collections::HashMap<u64, voice_speech::Streaming>>,
}

struct Listen {
    id: u64,
    stop: Arc<AtomicBool>,
    done: std::sync::mpsc::Receiver<voice_speech::Heard>,
}

pub(super) fn require_person(webview: &Webview) -> Result<(), String> {
    crate::browser::app_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Only Misty's own windows can use speech.".into())
}

/// A system voice the person can pick in Settings › Voice.
#[derive(Clone, Debug, Serialize)]
pub struct SystemVoice {
    pub id: String,
    pub name: String,
    pub language: String,
}

#[derive(Debug, Serialize)]
pub struct SpeechSupport {
    /// Whether this computer can recognize speech: the microphone and dictation show only then.
    pub recognition: bool,
    pub voices: Vec<SystemVoice>,
}

/// What this computer can do with speech, and the voices it has.
#[tauri::command]
pub async fn speech_support(webview: Webview) -> Result<SpeechSupport, String> {
    require_person(&webview)?;
    let recognition = tokio::task::spawn_blocking(voice_speech::supported)
        .await
        .unwrap_or(false);
    Ok(SpeechSupport {
        recognition,
        voices: system_voices().await,
    })
}

/// Recognizes a recorded audio file in `language` (the system's when unset).
#[tauri::command]
pub async fn speech_recognize_file(
    webview: Webview,
    path: String,
    language: Option<String>,
) -> Result<String, String> {
    require_person(&webview)?;
    tokio::task::spawn_blocking(move || voice_speech::recognize_file(&path, language.as_deref()))
        .await
        .map_err(|_| voice_speech::reason("failed"))?
}

/// Recognizes a short recording held by the window (the chat microphone's), sent as base64 with
/// its type. It's written to a temporary file for the recognizer and removed after.
#[tauri::command]
pub async fn speech_recognize_audio(
    webview: Webview,
    audio: String,
    mime: String,
    language: Option<String>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_person(&webview)?;
    // A minute of compressed speech is well under this.
    if audio.len() > 40 * 1024 * 1024 {
        return Err("That recording is too long to recognize.".into());
    }
    let bytes = STANDARD
        .decode(audio.as_bytes())
        .map_err(|_| voice_speech::reason("failed"))?;
    let extension = match mime.split(';').next().unwrap_or("").trim() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mpeg" => "mp3",
        "audio/webm" => "webm",
        "audio/ogg" => "ogg",
        _ => "audio",
    };
    let path =
        std::env::temp_dir().join(format!("misty-speech-{}.{extension}", uuid::Uuid::new_v4()));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| voice_speech::reason("failed"))?;
    let file = path.to_string_lossy().into_owned();
    let heard = tokio::task::spawn_blocking(move || {
        voice_speech::recognize_file(&file, language.as_deref())
    })
    .await
    .map_err(|_| voice_speech::reason("failed"));
    let _ = tokio::fs::remove_file(&path).await;
    heard?
}

/// Starts recognizing the microphone. What's heard arrives as `misty://speech-heard` events
/// (`{session, text, final}`) until `speech_listen_stop`. A new listen ends the one before.
#[tauri::command]
pub async fn speech_listen_start(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechState>,
    language: Option<String>,
) -> Result<u64, String> {
    require_person(&webview)?;
    let id = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(previous) = state.listening.lock().unwrap().take() {
        previous.stop.store(true, Ordering::SeqCst);
    }
    let owner = webview.label().to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let thread_stop = stop.clone();
    // The recognizer lives on one thread of its own, from start to stop.
    std::thread::spawn(move || {
        let listening = match voice_speech::listen(language.as_deref()) {
            Ok(listening) => {
                let _ = started_tx.send(Ok(()));
                listening
            }
            Err(error) => {
                let _ = started_tx.send(Err(error));
                return;
            }
        };
        let mut last = String::new();
        while !thread_stop.load(Ordering::SeqCst) {
            let heard = listening.heard();
            if heard.text != last {
                last = heard.text.clone();
                let _ = app.emit_to(
                    owner.as_str(),
                    HEARD_EVENT,
                    json!({ "session": id, "text": heard.text, "final": false }),
                );
            }
            if heard.done {
                break;
            }
            std::thread::sleep(POLL);
        }
        let heard = listening.stop();
        let _ = app.emit_to(
            owner.as_str(),
            HEARD_EVENT,
            json!({ "session": id, "text": heard.text, "final": true, "error": heard.error }),
        );
        let _ = done_tx.send(heard);
    });
    tokio::task::spawn_blocking(move || started_rx.recv())
        .await
        .map_err(|_| voice_speech::reason("failed"))?
        .map_err(|_| voice_speech::reason("failed"))??;
    *state.listening.lock().unwrap() = Some(Listen {
        id,
        stop,
        done: done_rx,
    });
    Ok(id)
}

/// Stops the live listen and answers everything heard.
#[tauri::command]
pub async fn speech_listen_stop(
    webview: Webview,
    state: State<'_, SpeechState>,
    session: u64,
) -> Result<String, String> {
    require_person(&webview)?;
    let listen = {
        let mut slot = state.listening.lock().unwrap();
        match slot.as_ref() {
            Some(current) if current.id == session => slot.take(),
            _ => None,
        }
    };
    let Some(listen) = listen else {
        return Ok(String::new());
    };
    listen.stop.store(true, Ordering::SeqCst);
    let heard =
        tokio::task::spawn_blocking(move || listen.done.recv_timeout(Duration::from_secs(5)))
            .await
            .map_err(|_| voice_speech::reason("failed"))?
            .unwrap_or_default();
    Ok(heard.text)
}

/// Starts recognizing audio the window feeds in (a capture's channel, 16 kHz mono PCM16).
#[tauri::command]
pub async fn speech_stream_start(
    webview: Webview,
    state: State<'_, SpeechState>,
    language: Option<String>,
) -> Result<u64, String> {
    require_person(&webview)?;
    let streaming = tokio::task::spawn_blocking(move || voice_speech::stream(language.as_deref()))
        .await
        .map_err(|_| voice_speech::reason("failed"))??;
    let id = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    state.streams.lock().unwrap().insert(id, streaming);
    Ok(id)
}

/// Feeds a stream base64 PCM16 little-endian samples.
#[tauri::command]
pub async fn speech_stream_push(
    webview: Webview,
    state: State<'_, SpeechState>,
    stream: u64,
    pcm: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_person(&webview)?;
    let bytes = STANDARD
        .decode(pcm.as_bytes())
        .map_err(|_| voice_speech::reason("failed"))?;
    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    if let Some(streaming) = state.streams.lock().unwrap().get(&stream) {
        streaming.push(&samples);
    }
    Ok(())
}

/// What a stream has heard so far.
#[tauri::command]
pub async fn speech_stream_poll(
    webview: Webview,
    state: State<'_, SpeechState>,
    stream: u64,
) -> Result<voice_speech::StreamHeard, String> {
    require_person(&webview)?;
    Ok(state
        .streams
        .lock()
        .unwrap()
        .get(&stream)
        .map(voice_speech::Streaming::heard)
        .unwrap_or_default())
}

/// Ends a stream and answers everything it heard.
#[tauri::command]
pub async fn speech_stream_stop(
    webview: Webview,
    state: State<'_, SpeechState>,
    stream: u64,
) -> Result<voice_speech::StreamHeard, String> {
    require_person(&webview)?;
    let Some(streaming) = state.streams.lock().unwrap().remove(&stream) else {
        return Ok(voice_speech::StreamHeard::default());
    };
    tokio::task::spawn_blocking(move || streaming.stop())
        .await
        .map_err(|_| voice_speech::reason("failed"))
}

/// Says `text` aloud in a system voice, at `rate` (1 is the voice's usual pace). Stops anything
/// already being said. Answers once it's done or stopped.
#[tauri::command]
pub async fn speech_say(
    webview: Webview,
    state: State<'_, SpeechState>,
    text: String,
    voice: Option<String>,
    rate: Option<f64>,
) -> Result<(), String> {
    require_person(&webview)?;
    let text: String = text.chars().take(20_000).collect();
    if text.trim().is_empty() {
        return Ok(());
    }
    stop_speaking(&state);
    let mut command = say_command(&text, voice.as_deref(), rate.unwrap_or(1.0))?;
    command.kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|_| "This computer's voice couldn't read it.".to_string())?;
    *state.speaking.lock().unwrap() = Some(child);
    // Waits without holding the lock, so `speech_stop` can end it.
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut slot = state.speaking.lock().unwrap();
        let Some(child) = slot.as_mut() else {
            return Ok(());
        };
        if !matches!(child.try_wait(), Ok(None)) {
            slot.take();
            return Ok(());
        }
    }
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

/// Turns the sound back on: unmutes the output, and raises it to half if it was all the way down.
/// Only on macOS; the person asked for it (the muted notice's button).
#[tauri::command]
pub async fn speech_sound_on(webview: Webview) -> Result<(), String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    core_audio::sound_on();
    Ok(())
}

/// Whether another app is using the microphone, as on a call or in a recording, so Misty keeps
/// quiet about things nobody asked for just now. Only macOS says.
#[tauri::command]
pub async fn speech_on_call(webview: Webview) -> Result<bool, String> {
    require_person(&webview)?;
    #[cfg(target_os = "macos")]
    return Ok(core_audio::microphone_busy());
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

/// The default sound devices, read straight from Core Audio.
#[cfg(target_os = "macos")]
mod core_audio {
    use std::ffi::c_void;

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
            data: *mut c_void,
        ) -> i32;
        fn AudioObjectSetPropertyData(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: u32,
            data: *const c_void,
        ) -> i32;
    }

    const SYSTEM: u32 = 1;
    const fn code(name: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*name)
    }
    const GLOBAL: u32 = code(b"glob");
    const OUTPUT: u32 = code(b"outp");
    const MAIN: u32 = 0;

    fn read<T: Default>(object: u32, selector: u32, scope: u32) -> Option<T> {
        let address = Address { selector, scope, element: MAIN };
        let mut value = T::default();
        let mut size = std::mem::size_of::<T>() as u32;
        // SAFETY: `value` is a plain value of `size` bytes, written by the call.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                (&mut value as *mut T).cast(),
            )
        };
        (status == 0).then_some(value)
    }

    pub(super) fn output_muted() -> bool {
        let Some(device) = read::<u32>(SYSTEM, code(b"dOut"), GLOBAL).filter(|id| *id != 0) else {
            return false;
        };
        let muted = read::<u32>(device, code(b"mute"), OUTPUT).is_some_and(|mute| mute != 0);
        let silent = read::<f32>(device, code(b"volm"), OUTPUT).is_some_and(|volume| volume < 0.01);
        muted || silent
    }

    fn write<T>(object: u32, selector: u32, scope: u32, value: T) {
        let address = Address { selector, scope, element: MAIN };
        // SAFETY: `value` is a plain value of the size passed, read by the call.
        unsafe {
            AudioObjectSetPropertyData(
                object,
                &address,
                0,
                std::ptr::null(),
                std::mem::size_of::<T>() as u32,
                (&value as *const T).cast(),
            );
        }
    }

    pub(super) fn sound_on() {
        let Some(device) = read::<u32>(SYSTEM, code(b"dOut"), GLOBAL).filter(|id| *id != 0) else {
            return;
        };
        write::<u32>(device, code(b"mute"), OUTPUT, 0);
        if read::<f32>(device, code(b"volm"), OUTPUT).is_some_and(|volume| volume < 0.05) {
            write::<f32>(device, code(b"volm"), OUTPUT, 0.5);
        }
    }

    pub(super) fn microphone_busy() -> bool {
        read::<u32>(SYSTEM, code(b"dIn "), GLOBAL)
            .filter(|id| *id != 0)
            .and_then(|device| read::<u32>(device, code(b"gone"), GLOBAL))
            .is_some_and(|running| running != 0)
    }
}

mod aloud;
pub use aloud::*;
