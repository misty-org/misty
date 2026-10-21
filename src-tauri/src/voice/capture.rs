//! Voice captures the person starts: the microphone, system audio (without
//! Misty's own sound) and specific apps or tabs, as separate channels. Mute
//! closes the microphone; unmute reopens it. Nothing here starts on its own.
use audeeo_core::{AudioSource, Capture, Channel, DuplexRouter, PcmChunk};
use base64::{engine::general_purpose::STANDARD, Engine};
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
    /// Only these processes (an app, or a tab's web content process).
    #[serde(default)]
    pub pids: Vec<u32>,
}

#[derive(Default)]
pub struct CaptureState {
    session: AtomicU64,
    running: Mutex<Option<Running>>,
}

struct Running {
    id: u64,
    mic: Option<Capture>,
    other: Option<Capture>,
    router: Arc<Mutex<DuplexRouter>>,
    want_mic: bool,
}

fn require_main(webview: &Webview) -> Result<(), String> {
    crate::infra::space_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Main Misty window required.".into())
}

fn emit_chunks(app: &AppHandle, session: u64, chunks: Vec<PcmChunk>) {
    for chunk in chunks {
        let channel = if chunk.channel == Channel::Mic {
            "mic"
        } else {
            "system"
        };
        let _ = crate::infra::space_windows::emit_to_primary(
            &app,
            "misty://capture-audio",
            json!({"session": session, "channel": channel, "startFrame": chunk.start_frame, "power": chunk.power(), "pcm": STANDARD.encode(chunk.to_le_bytes())}),
        );
    }
}

fn open(
    app: &AppHandle,
    session: u64,
    source: AudioSource,
    router: Arc<Mutex<DuplexRouter>>,
) -> Result<Capture, String> {
    let chunk_app = app.clone();
    let failure_app = app.clone();
    let channel = source.channel();
    audeeo_core::start(
        source,
        move |chunk| {
            let ready = router.lock().map(|mut r| r.push(chunk)).unwrap_or_default();
            emit_chunks(&chunk_app, session, ready);
        },
        move |error| {
            let _ = crate::infra::space_windows::emit_to_primary(&failure_app,
                "misty://capture-state",
                json!({"session": session, "channel": if channel == Channel::Mic { "mic" } else { "system" }, "error": error.to_string()}),
            );
        },
    )
    .map_err(|error| error.to_string())
}

/// The default microphone's name, apps playing audio, and what this computer can capture.
#[tauri::command]
pub fn voice_capture_sources(webview: Webview) -> Result<serde_json::Value, String> {
    require_main(&webview)?;
    let sources = audeeo_core::capture_sources().unwrap_or_default();
    Ok(
        json!({"microphone": sources.microphone, "applications": sources.applications, "capabilities": audeeo_core::capabilities()}),
    )
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
    if !request.mic && !request.system && request.pids.is_empty() {
        return Err("Choose at least one sound to capture.".into());
    }
    let mut running = state.running.lock().map_err(|_| "Capture is busy.")?;
    if let Some(previous) = running.take() {
        drop(previous);
    }
    let session = state.session.fetch_add(1, Ordering::SeqCst) + 1;
    let has_other = request.system || !request.pids.is_empty();
    // With both channels open, the system channel is the echo reference.
    let router = Arc::new(Mutex::new(DuplexRouter::new(request.mic && has_other)));
    let other = if has_other {
        let source = if request.pids.is_empty() {
            AudioSource::System { exclude_self: true }
        } else {
            AudioSource::Processes(request.pids.clone())
        };
        Some(open(&app, session, source, router.clone())?)
    } else {
        None
    };
    let mic = if request.mic {
        Some(open(&app, session, AudioSource::Mic, router.clone())?)
    } else {
        None
    };
    *running = Some(Running {
        id: session,
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
            running.id,
            AudioSource::Mic,
            running.router.clone(),
        )?);
    }
    let _ = crate::infra::space_windows::emit_to_primary(
        &app,
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
        emit_chunks(&app, running.id, rest);
        let _ = crate::infra::space_windows::emit_to_primary(
            &app,
            "misty://capture-state",
            json!({"session": running.id, "stopped": true}),
        );
    }
    Ok(())
}
