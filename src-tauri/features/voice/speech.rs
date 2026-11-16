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

fn require_person(webview: &Webview) -> Result<(), String> {
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

/// Stops whatever is being said.
#[tauri::command]
pub async fn speech_stop(webview: Webview, state: State<'_, SpeechState>) -> Result<(), String> {
    require_person(&webview)?;
    stop_speaking(&state);
    Ok(())
}

fn stop_speaking(state: &SpeechState) {
    if let Some(mut child) = state.speaking.lock().unwrap().take() {
        let _ = child.start_kill();
    }
    if let Some(reading) = state.reading.lock().unwrap().take() {
        reading.stop.notify_one();
    }
}

/// A reply read aloud while it's still being written: each sentence is handed over as it's
/// finished and read straight after the one before, so speaking starts with the first sentence
/// instead of the whole reply. The voice is set up as the reading opens, before any sentence.
struct Reading {
    id: u64,
    /// Closed once the last sentence is in.
    sentences: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    stop: Arc<tokio::sync::Notify>,
    done: tokio::sync::watch::Receiver<bool>,
    /// How many sentences the voice has begun, for drawing in step with it.
    started: Arc<AtomicU32>,
}

/// Opens a reading in a system voice at `rate` (1 is the voice's usual pace), stopping anything
/// already being said. Sentences follow through `speech_reading_add`.
#[tauri::command]
pub async fn speech_reading_start(
    webview: Webview,
    state: State<'_, SpeechState>,
    voice: Option<String>,
    rate: Option<f64>,
) -> Result<u64, String> {
    require_person(&webview)?;
    stop_speaking(&state);
    let id = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    let (sentences, heard) = tokio::sync::mpsc::unbounded_channel();
    let stop = Arc::new(tokio::sync::Notify::new());
    let (finished, done) = tokio::sync::watch::channel(false);
    let rate = rate.unwrap_or(1.0).clamp(0.5, 2.0);
    let started = Arc::new(AtomicU32::new(0));
    let (stopped, begun) = (stop.clone(), started.clone());
    tokio::spawn(async move {
        tokio::select! {
            _ = stopped.notified() => {}
            _ = read_aloud(heard, voice, rate, begun) => {}
        }
        let _ = finished.send(true);
    });
    *state.reading.lock().unwrap() = Some(Reading {
        id,
        sentences: Some(sentences),
        stop,
        done,
        started,
    });
    Ok(id)
}

/// How many of a reading's sentences the voice has begun. A reading that has ended, or was
/// stopped, has begun them all, which reads as a very large number.
#[tauri::command]
pub async fn speech_reading_progress(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
) -> Result<u32, String> {
    require_person(&webview)?;
    let slot = state.reading.lock().unwrap();
    Ok(match slot.as_ref() {
        Some(open) if open.id == reading && !*open.done.borrow() => {
            open.started.load(Ordering::SeqCst)
        }
        _ => u32::MAX,
    })
}

/// Hands a reading its next sentence.
#[tauri::command]
pub async fn speech_reading_add(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
    text: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let text: String = text
        .chars()
        .take(4_000)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if text.trim().is_empty() {
        return Ok(());
    }
    if let Some(open) = state.reading.lock().unwrap().as_ref() {
        if open.id == reading {
            if let Some(sentences) = &open.sentences {
                let _ = sentences.send(text.trim().to_string());
            }
        }
    }
    Ok(())
}

/// Says the reading has all its sentences. Answers once they've been read, or it was stopped.
#[tauri::command]
pub async fn speech_reading_end(
    webview: Webview,
    state: State<'_, SpeechState>,
    reading: u64,
) -> Result<(), String> {
    require_person(&webview)?;
    let done = {
        let mut slot = state.reading.lock().unwrap();
        match slot.as_mut() {
            Some(open) if open.id == reading => {
                open.sentences = None;
                open.done.clone()
            }
            _ => return Ok(()),
        }
    };
    let mut done = done;
    while !*done.borrow_and_update() {
        if done.changed().await.is_err() {
            break;
        }
    }
    let mut slot = state.reading.lock().unwrap();
    if slot.as_ref().is_some_and(|open| open.id == reading) {
        slot.take();
    }
    Ok(())
}

/// Reads each sentence as it arrives, until the last one has been read. Dropping it stops the voice.
#[cfg(target_os = "macos")]
async fn read_aloud(
    mut sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    // AVSpeechSynthesizer queues sentences with no gap; `say` is the fallback.
    let Ok(speaker) = voice_speech::Speaker::new(voice.as_deref(), rate) else {
        return read_one_by_one(sentences, voice, rate, started).await;
    };
    let mut open = true;
    loop {
        tokio::select! {
            next = sentences.recv(), if open => match next {
                Some(sentence) => speaker.say(&sentence),
                None => open = false,
            },
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
        started.store(speaker.started(), Ordering::SeqCst);
        if !open && !speaker.busy() {
            break;
        }
    }
}

/// One PowerShell voice for the whole reading, started as it opens (starting it is the slow
/// part), reading each line it's handed.
#[cfg(windows)]
async fn read_aloud(
    mut sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    const SCRIPT: &str = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; \
        Add-Type -AssemblyName System.Speech; \
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
        if ($env:MISTY_VOICE) { try { $s.SelectVoice($env:MISTY_VOICE) } catch {} }; \
        $s.Rate = [int]$env:MISTY_RATE; \
        while ($null -ne ($line = [Console]::In.ReadLine())) { if ($line.Trim()) { [Console]::Out.WriteLine('s'); [Console]::Out.Flush(); $s.Speak($line) } }; \
        $s.Dispose()";
    let steps = ((rate - 1.0) * 10.0).round().clamp(-10.0, 10.0) as i32;
    let mut command = tokio::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("MISTY_VOICE", voice.unwrap_or_default())
        .env("MISTY_RATE", steps.to_string())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true);
    crate::engine_config::support::hide_console_tokio(&mut command);
    let Ok(mut child) = command.spawn() else {
        return;
    };
    let Some(mut input) = child.stdin.take() else {
        return;
    };
    // The voice says "s" on a line of its own as it begins each sentence.
    if let Some(output) = child.stdout.take() {
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(output).lines();
            while let Ok(Some(_)) = lines.next_line().await {
                started.fetch_add(1, Ordering::SeqCst);
            }
        });
    }
    while let Some(sentence) = sentences.recv().await {
        let line = format!("{sentence}\n");
        if input.write_all(line.as_bytes()).await.is_err() || input.flush().await.is_err() {
            break;
        }
    }
    drop(input);
    let _ = child.wait().await;
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn read_aloud(
    sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    read_one_by_one(sentences, voice, rate, started).await
}

/// Each sentence in a voice process of its own, one after another.
#[cfg_attr(windows, allow(dead_code))]
async fn read_one_by_one(
    mut sentences: tokio::sync::mpsc::UnboundedReceiver<String>,
    voice: Option<String>,
    rate: f64,
    started: Arc<AtomicU32>,
) {
    while let Some(sentence) = sentences.recv().await {
        started.fetch_add(1, Ordering::SeqCst);
        let Ok(mut command) = say_command(&sentence, voice.as_deref(), rate) else {
            return;
        };
        command.kill_on_drop(true);
        let Ok(mut child) = command.spawn() else {
            return;
        };
        let _ = child.wait().await;
    }
}

#[cfg(target_os = "macos")]
fn say_command(
    text: &str,
    voice: Option<&str>,
    rate: f64,
) -> Result<tokio::process::Command, String> {
    let mut command = tokio::process::Command::new("say");
    if let Some(voice) = voice.filter(|voice| !voice.trim().is_empty()) {
        command.args(["-v", voice.trim()]);
    }
    // `say` speaks about 175 words a minute by default.
    let words = (175.0 * rate.clamp(0.5, 2.0)).round() as u32;
    command.args(["-r", &words.to_string(), "--"]).arg(text);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn say_command(
    text: &str,
    voice: Option<&str>,
    rate: f64,
) -> Result<tokio::process::Command, String> {
    let program = ["espeak-ng", "espeak"]
        .into_iter()
        .find(|name| on_path(name))
        .ok_or_else(|| "This computer has no voice to read it. Install espeak-ng.".to_string())?;
    let mut command = tokio::process::Command::new(program);
    let words = (165.0 * rate.clamp(0.5, 2.0)).round() as u32;
    command
        .args([
            "-v",
            voice
                .filter(|voice| !voice.trim().is_empty())
                .unwrap_or("en-us"),
        ])
        .args(["-s", &words.to_string(), "--"])
        .arg(text);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        .unwrap_or(false)
}

#[cfg(windows)]
fn say_command(
    text: &str,
    voice: Option<&str>,
    rate: f64,
) -> Result<tokio::process::Command, String> {
    // The text and voice go in through the environment, so nothing needs quoting.
    const SCRIPT: &str = "Add-Type -AssemblyName System.Speech; \
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
        if ($env:MISTY_VOICE) { try { $s.SelectVoice($env:MISTY_VOICE) } catch {} }; \
        $s.Rate = [int]$env:MISTY_RATE; \
        $s.Speak($env:MISTY_TEXT); \
        $s.Dispose()";
    // System.Speech rates run from -10 to 10, 0 being the voice's usual pace.
    let steps = ((rate.clamp(0.5, 2.0) - 1.0) * 10.0)
        .round()
        .clamp(-10.0, 10.0) as i32;
    let mut command = tokio::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("MISTY_TEXT", text)
        .env("MISTY_VOICE", voice.unwrap_or(""))
        .env("MISTY_RATE", steps.to_string());
    crate::engine_config::support::hide_console_tokio(&mut command);
    Ok(command)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn say_command(
    _text: &str,
    _voice: Option<&str>,
    _rate: f64,
) -> Result<tokio::process::Command, String> {
    Err("This computer has no voice to read it.".into())
}

/// The system's voices, for the voice picker.
async fn system_voices() -> Vec<SystemVoice> {
    #[cfg(target_os = "macos")]
    {
        let listed = tokio::process::Command::new("say")
            .args(["-v", "?"])
            .output()
            .await
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed.lines().filter_map(parse_say_voice).collect()
    }
    #[cfg(windows)]
    {
        const SCRIPT: &str = "Add-Type -AssemblyName System.Speech; \
            $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
            $s.GetInstalledVoices() | Where-Object { $_.Enabled } | \
            ForEach-Object { $_.VoiceInfo.Name + \"`t\" + $_.VoiceInfo.Culture.Name }";
        let mut command = tokio::process::Command::new("powershell");
        command.args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT]);
        crate::engine_config::support::hide_console_tokio(&mut command);
        let listed = command
            .output()
            .await
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed
            .lines()
            .filter_map(|line| {
                let (name, language) = line.trim().split_once('\t')?;
                Some(SystemVoice {
                    id: name.to_string(),
                    name: name.to_string(),
                    language: language.to_string(),
                })
            })
            .collect()
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Vec::new()
    }
}

/// One line of `say -v ?`: "Samantha            en_US    # Hello, my name is Samantha."
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_say_voice(line: &str) -> Option<SystemVoice> {
    let head = line.split('#').next()?.trim_end();
    let language_at = head.rfind(char::is_whitespace)?;
    let language = head[language_at..].trim();
    let name = head[..language_at].trim();
    if name.is_empty() || !language.contains('_') {
        return None;
    }
    Some(SystemVoice {
        id: name.to_string(),
        name: name.to_string(),
        language: language.replace('_', "-"),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_say_voice;

    #[test]
    fn reads_a_say_voice_line() {
        let voice = parse_say_voice("Samantha            en_US    # Hello, my name is Samantha.")
            .expect("a voice");
        assert_eq!(voice.name, "Samantha");
        assert_eq!(voice.language, "en-US");
        let named = parse_say_voice("Eddy (English (US))  en_US    # Hello! My name is Eddy.")
            .expect("a voice with a long name");
        assert_eq!(named.name, "Eddy (English (US))");
        assert!(parse_say_voice("").is_none());
    }
}
