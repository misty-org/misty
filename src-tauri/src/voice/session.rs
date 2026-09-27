//! Native side of dictation: the shortcut, the microphone and insertion.
//! The renderer owns the live transcription socket, cleanup and routing.
use super::dictation::{Action, Dictation};
use super::insert::{self, Inserted};
use crate::infra::global_hotkey::{self, Chord, HotkeyEvent, Subscription};
use audeeo_core::{AudioSource, Capture};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State, Webview};

/// Keep recording briefly after release so the last word isn't clipped.
const TAIL: Duration = Duration::from_millis(180);

#[derive(Default)]
pub struct DictationState {
    inner: Mutex<Option<Running>>,
    /// Each dictation's number, so late audio from an old one is ignored.
    turn: Arc<AtomicU64>,
}

#[derive(Clone)]
struct Running {
    machine: Arc<Mutex<Dictation>>,
    capture: Arc<Mutex<Option<Capture>>>,
    stop: Arc<AtomicBool>,
}

fn require_main(webview: &Webview) -> Result<(), String> {
    (webview.label() == "main").then_some(()).ok_or_else(|| "Main Misty window required.".into())
}

fn emit(app: &AppHandle, turn: u64, phase: &str) {
    let _ = app.emit_to("main", "misty://dictation", json!({"turn": turn, "phase": phase}));
}

fn start_capture(app: &AppHandle, turn: u64, current: Arc<AtomicU64>) -> Result<Capture, String> {
    let audio_app = app.clone();
    let error_app = app.clone();
    let failed_turn = current.clone();
    audeeo_core::start(
        AudioSource::Mic,
        move |chunk| {
            if current.load(Ordering::SeqCst) != turn {
                return;
            }
            let _ = audio_app.emit_to(
                "main",
                "misty://dictation-audio",
                json!({"turn": turn, "startFrame": chunk.start_frame, "power": chunk.power(), "pcm": STANDARD.encode(chunk.to_le_bytes())}),
            );
        },
        move |error| {
            if failed_turn.load(Ordering::SeqCst) == turn {
                let _ = error_app.emit_to("main", "misty://dictation", json!({"turn": turn, "phase": "error", "message": error.to_string()}));
            }
        },
    )
    .map_err(|error| error.to_string())
}

fn act(app: &AppHandle, state: &Running, turn_counter: &Arc<AtomicU64>, action: Action) {
    match action {
        Action::Start => {
            let turn = turn_counter.fetch_add(1, Ordering::SeqCst) + 1;
            super::pill::show(app);
            match start_capture(app, turn, turn_counter.clone()) {
                Ok(capture) => {
                    *state.capture.lock().unwrap() = Some(capture);
                    emit(app, turn, "start");
                }
                Err(message) => {
                    let _ = state.machine.lock().map(|mut m| m.abort());
                    let _ = app.emit_to("main", "misty://dictation", json!({"turn": turn, "phase": "error", "message": message}));
                }
            }
        }
        Action::Lock => emit(app, turn_counter.load(Ordering::SeqCst), "lock"),
        Action::Finish | Action::Cancel => {
            let turn = turn_counter.load(Ordering::SeqCst);
            if action == Action::Finish {
                std::thread::sleep(TAIL);
            }
            if let Some(capture) = state.capture.lock().unwrap().take() {
                capture.stop();
            }
            emit(app, turn, if action == Action::Finish { "finish" } else { "cancel" });
            if action == Action::Cancel {
                super::pill::hide(app);
            }
        }
    }
}

fn listen(app: AppHandle, subscription: Subscription, running: Running, turns: Arc<AtomicU64>) {
    while !running.stop.load(Ordering::SeqCst) {
        let event = subscription.events.recv_timeout(Duration::from_millis(50));
        let now = Instant::now();
        let action = match event {
            Ok(HotkeyEvent::Down) => running.machine.lock().unwrap().key_down(now),
            Ok(HotkeyEvent::Up) => running.machine.lock().unwrap().key_up(now),
            Ok(HotkeyEvent::Error(message)) => {
                let _ = app.emit_to("main", "misty://dictation", json!({"turn": turns.load(Ordering::SeqCst), "phase": "error", "message": message}));
                None
            }
            Ok(_) => None,
            Err(_) => running.machine.lock().unwrap().tick(now),
        };
        if let Some(action) = action {
            act(&app, &running, &turns, action);
        }
    }
    if let Some(capture) = running.capture.lock().unwrap().take() {
        capture.stop();
    }
}

/// Turns dictation on with a chord ("Fn", "RightAlt", …) or off. The
/// microphone opens only while the chord is held or locked.
#[tauri::command]
pub fn voice_dictation_configure(
    webview: Webview,
    app: AppHandle,
    state: State<'_, DictationState>,
    enabled: bool,
    chord: Option<String>,
    hands_free: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    let mut inner = state.inner.lock().map_err(|_| "Dictation is busy.")?;
    if let Some(previous) = inner.take() {
        previous.stop.store(true, Ordering::SeqCst);
    }
    if !enabled {
        super::pill::hide(&app);
        return Ok(());
    }
    let chord = chord.as_deref().and_then(Chord::parse).unwrap_or_else(Chord::dictation_default);
    let subscription = global_hotkey::subscribe(chord);
    let running = Running {
        machine: Arc::new(Mutex::new(Dictation::new(hands_free))),
        capture: Arc::new(Mutex::new(None)),
        stop: Arc::new(AtomicBool::new(false)),
    };
    let listener = running.clone();
    let turns = state.turn.clone();
    std::thread::Builder::new()
        .name("misty-dictation".into())
        .spawn(move || listen(app, subscription, listener, turns))
        .map_err(|e| e.to_string())?;
    *inner = Some(running);
    Ok(())
}

/// Mute or the pill's Stop: end the current dictation without inserting.
#[tauri::command]
pub fn voice_dictation_stop(webview: Webview, app: AppHandle, state: State<'_, DictationState>) -> Result<(), String> {
    require_main(&webview)?;
    let inner = state.inner.lock().map_err(|_| "Dictation is busy.")?;
    if let Some(running) = inner.as_ref() {
        if let Some(action) = running.machine.lock().unwrap().abort() {
            act(&app, running, &state.turn, action);
        }
    }
    super::pill::hide(&app);
    Ok(())
}

/// Puts finished text where the person is typing. Returns "misty" when Misty
/// itself is frontmost, so the renderer inserts it without the clipboard;
/// `force` pastes anyway (a web page in a tab has focus).
#[tauri::command]
pub async fn voice_dictation_insert(webview: Webview, text: String, force: bool) -> Result<serde_json::Value, String> {
    require_main(&webview)?;
    if text.trim().is_empty() {
        return Ok(json!({"inserted": "nothing"}));
    }
    if !force && insert::misty_is_frontmost() {
        return Ok(json!({"inserted": "misty"}));
    }
    let result = tauri::async_runtime::spawn_blocking(move || insert::paste_into_frontmost(&text))
        .await
        .map_err(|e| e.to_string())??;
    Ok(json!({"inserted": match result {
        Inserted::Pasted => "pasted",
        Inserted::OnClipboard => "clipboard",
        Inserted::KeysHeld => "keys-held",
    }}))
}

/// Hides the pill once the renderer has shown how dictation ended.
#[tauri::command]
pub fn voice_dictation_pill_hide(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_main(&webview)?;
    super::pill::hide(&app);
    Ok(())
}
