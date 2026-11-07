//! Voice captures the person starts: the microphone, system audio (without
//! Misty's own sound unless asked) and specific apps or tabs, as separate
//! channels, sent to the window that started them. Mute closes the microphone;
//! unmute reopens it. Nothing here starts on its own.
use base64::{engine::general_purpose::STANDARD, Engine};
use misty_audio_capture::{AudioSource, Capture, Channel, DuplexRouter, PcmChunk};
use serde::Deserialize;
use serde_json::json;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, State, Webview};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub mic: bool,
    /// Everything the computer plays, except Misty.
    pub system: bool,
    /// System audio with Misty in it.
    #[serde(default)]
    pub include_misty: bool,
    /// Only what Misty's own tabs play: live subtitles hear nothing else on the computer.
    #[serde(default)]
    pub misty_only: bool,
    /// Only these processes (an app, or a tab's web content process).
    #[serde(default)]
    pub pids: Vec<u32>,
}

/// Misty's tabs have no audio process yet, which is normal before anything plays.
const MISTY_TABS_SILENT: &str = "misty_tabs_silent";

/// The processes playing Misty's tabs, asked of each page itself. macOS can't say which WebKit
/// processes are Misty's by owner, since a dev build's are counted to whatever launched it. Pages
/// play through a GPU process they share, and a page process can hold audio too.
#[cfg(target_os = "macos")]
fn misty_tab_processes(app: &AppHandle) -> Vec<u32> {
    use objc2::{msg_send, runtime::AnyObject, sel};
    use tauri::Manager;
    let (send, receive) = std::sync::mpsc::channel::<u32>();
    let mut asked = 0;
    for (label, page) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        let send = send.clone();
        let answered = page.with_webview(move |platform| unsafe {
            let view: &AnyObject = &*platform.inner().cast();
            // Private to WebKit, so the GPU process is asked for only where it's still there.
            let has_gpu: bool = msg_send![view, respondsToSelector: sel!(_gpuProcessIdentifier)];
            let gpu: i32 = if has_gpu { msg_send![view, _gpuProcessIdentifier] } else { 0 };
            let page: i32 = msg_send![view, _webProcessIdentifier];
            let _ = send.send(gpu.max(0) as u32);
            let _ = send.send(page.max(0) as u32);
        });
        if answered.is_ok() {
            asked += 2;
        }
    }
    drop(send);
    let mut pids: Vec<u32> = (0..asked)
        .filter_map(|_| receive.recv_timeout(std::time::Duration::from_secs(2)).ok())
        .filter(|pid| *pid > 1)
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

/// WebView2 runs under this process, and a loopback capture of it takes its whole process tree.
#[cfg(windows)]
fn misty_tab_processes(_app: &AppHandle) -> Vec<u32> {
    vec![std::process::id()]
}

#[cfg(not(any(target_os = "macos", windows)))]
fn misty_tab_processes(_app: &AppHandle) -> Vec<u32> {
    Vec::new()
}

#[derive(Default)]
pub struct CaptureState {
    session: AtomicU64,
    running: Mutex<Option<Running>>,
}

struct Running {
    id: u64,
    /// The window that started this capture and receives its audio.
    owner: String,
    mic: Option<Capture>,
    other: Option<Capture>,
    router: Arc<Mutex<DuplexRouter>>,
    want_mic: bool,
}

fn require_main(webview: &Webview) -> Result<(), String> {
    crate::infra::profile_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Main Misty window required.".into())
}

fn emit_chunks(app: &AppHandle, owner: &str, session: u64, chunks: Vec<PcmChunk>) {
    for chunk in chunks {
        let channel = if chunk.channel == Channel::Mic {
            "mic"
        } else {
            "system"
        };
        let _ = app.emit_to(
            owner,
            "misty://capture-audio",
            json!({"session": session, "channel": channel, "startFrame": chunk.start_frame, "power": chunk.power(), "pcm": STANDARD.encode(chunk.to_le_bytes())}),
        );
    }
}

fn open(
    app: &AppHandle,
    owner: &str,
    session: u64,
    source: AudioSource,
    router: Arc<Mutex<DuplexRouter>>,
) -> Result<Capture, String> {
    let chunk_app = app.clone();
    let failure_app = app.clone();
    let chunk_owner = owner.to_owned();
    let failure_owner = owner.to_owned();
    let channel = source.channel();
    misty_audio_capture::start(
        source,
        move |chunk| {
            let ready = router.lock().map(|mut r| r.push(chunk)).unwrap_or_default();
            emit_chunks(&chunk_app, &chunk_owner, session, ready);
        },
        move |error| {
            let _ = failure_app.emit_to(
                failure_owner.as_str(),
                "misty://capture-state",
                json!({"session": session, "channel": if channel == Channel::Mic { "mic" } else { "system" }, "error": error.to_string()}),
            );
        },
    )
    .map_err(|error| error.to_string())
}

/// Starts a capture and returns its session number. Audio arrives as
/// `misty://capture-audio` events, one channel per stream.
#[tauri::command]
pub fn voice_capture_start(
    webview: Webview,
    app: AppHandle,
    state: State<'_, CaptureState>,
    request: CaptureRequest,
) -> Result<u64, String> {
    require_main(&webview)?;
    let mut request = request;
    if request.misty_only {
        request.mic = false;
        request.system = false;
        request.pids = misty_tab_processes(&app);
        // Nothing has played yet, so there's no audio process to listen to. The caller retries.
        if request.pids.is_empty() {
            return Err(MISTY_TABS_SILENT.into());
        }
    }
    if !request.mic && !request.system && request.pids.is_empty() {
        return Err("Choose at least one sound to capture.".into());
    }
    let mut running = state.running.lock().map_err(|_| "Capture is busy.")?;
    if let Some(previous) = running.take() {
        drop(previous);
    }
    let session = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    let owner = webview.label().to_owned();
    let has_other = request.system || !request.pids.is_empty();
    // With both channels open, the system channel is the echo reference.
    let router = Arc::new(Mutex::new(DuplexRouter::new(request.mic && has_other)));
    let other = if has_other {
        let source = if request.pids.is_empty() {
            AudioSource::System {
                exclude_self: !request.include_misty,
            }
        } else {
            AudioSource::Processes(request.pids.clone())
        };
        let opened = open(&app, &owner, session, source, router.clone());
        // These processes exist but none has made a sound yet, which is the same as no process.
        let silent = misty_audio_capture::CaptureError::NoSuchProcess.to_string();
        Some(opened.map_err(|error| {
            if request.misty_only && error == silent {
                MISTY_TABS_SILENT.to_owned()
            } else {
                error
            }
        })?)
    } else {
        None
    };
    let mic = if request.mic {
        Some(open(
            &app,
            &owner,
            session,
            AudioSource::Mic,
            router.clone(),
        )?)
    } else {
        None
    };
    *running = Some(Running {
        id: session,
        owner,
        mic,
        other,
        router,
        want_mic: request.mic,
    });
    Ok(session)
}

/// Mute closes the microphone; other channels keep going.
#[tauri::command]
pub fn voice_capture_mute(
    webview: Webview,
    app: AppHandle,
    state: State<'_, CaptureState>,
    muted: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    let mut guard = state.running.lock().map_err(|_| "Capture is busy.")?;
    let Some(running) = guard.as_mut() else {
        return Ok(());
    };
    if !running.want_mic {
        return Ok(());
    }
    if muted {
        if let Some(mic) = running.mic.take() {
            mic.stop();
        }
    } else if running.mic.is_none() {
        running.mic = Some(open(
            &app,
            &running.owner,
            running.id,
            AudioSource::Mic,
            running.router.clone(),
        )?);
    }
    let _ = app.emit_to(
        running.owner.as_str(),
        "misty://capture-state",
        json!({"session": running.id, "muted": muted}),
    );
    Ok(())
}

#[tauri::command]
pub fn voice_capture_stop(
    webview: Webview,
    app: AppHandle,
    state: State<'_, CaptureState>,
) -> Result<(), String> {
    require_main(&webview)?;
    let mut guard = state.running.lock().map_err(|_| "Capture is busy.")?;
    if let Some(mut running) = guard.take() {
        if let Some(mic) = running.mic.take() {
            mic.stop();
        }
        if let Some(other) = running.other.take() {
            other.stop();
        }
        let rest = running
            .router
            .lock()
            .map(|mut r| r.flush())
            .unwrap_or_default();
        emit_chunks(&app, &running.owner, running.id, rest);
        let _ = app.emit_to(
            running.owner.as_str(),
            "misty://capture-state",
            json!({"session": running.id, "stopped": true}),
        );
    }
    Ok(())
}
