use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

pub(super) fn start(app: AppHandle, state: Arc<CursorCompanionState>) {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || platform::shortcut(tx));
    let (audio_tx, audio_rx) = mpsc::channel();
    let events_app = app.clone();
    let events_state = state.clone();
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if !events_state.enabled.load(Ordering::SeqCst) {
                continue;
            }
            match event {
                Shortcut::Click(x, y) => forward_click(&events_app, &events_state, x, y),
                Shortcut::Type if !events_state.held.load(Ordering::SeqCst) => {
                    ask::open(&events_app)
                }
                Shortcut::Type => {}
                Shortcut::Escape => {
                    let tip = events_state.data.lock().is_ok_and(|data| {
                        data.presentation["caption"]["tip"].as_bool() == Some(true)
                    });
                    if tip {
                        crate::browser::app_windows::emit_to_primary(
                            &events_app,
                            "misty://cursor-escape",
                            json!({}),
                        );
                    }
                }
                Shortcut::Held(held) => {
                    if events_state.held.swap(held, Ordering::SeqCst) == held {
                        continue;
                    }
                    if held {
                        events_state.trail.lock().unwrap().clear();
                    }
                    let turn = if held {
                        events_state.turn.fetch_add(1, Ordering::SeqCst) + 1
                    } else {
                        events_state.turn.load(Ordering::SeqCst)
                    };
                    if held {
                        if let Some(window) = events_app.get_webview_window("misty-cursor-controls")
                        {
                            let _ = window.hide();
                        }
                    }
                    crate::browser::app_windows::emit_to_primary(
                        &events_app,
                        "misty://cursor-shortcut",
                        json!({"turn":turn,"held":held}),
                    );
                    let _ = audio_tx.send((turn, held));
                }
                Shortcut::Error(message) => error(
                    &events_app,
                    events_state.turn.load(Ordering::SeqCst),
                    message,
                ),
            }
        }
    });
    let audio_app = app.clone();
    let audio_state = state.clone();
    std::thread::spawn(move || {
        let mut recording: Option<(u64, Instant, audio::Recording)> = None;
        loop {
            if recording
                .as_ref()
                .is_some_and(|(turn, _, _)| !current(&audio_state, *turn))
            {
                recording = None;
            }
            if let Some((turn, _, record)) = recording.as_mut() {
                if let Some((sequence, pcm)) = record.drain() {
                    if current(&audio_state, *turn) {
                        crate::browser::app_windows::emit_to_primary(
                            &audio_app,
                            "misty://cursor-audio",
                            json!({"turn":turn,"sequence":sequence,"audio":STANDARD.encode(pcm)}),
                        );
                    }
                }
            }
            let event = audio_rx.recv_timeout(Duration::from_millis(25));
            let timed_out = recording
                .as_ref()
                .is_some_and(|(_, start, _)| start.elapsed() >= Duration::from_secs(60));
            match event {
                Ok((turn, true)) => {
                    recording = None;
                    if !current(&audio_state, turn) {
                        continue;
                    }
                    if !audio_state.held.load(Ordering::SeqCst) {
                        crate::browser::app_windows::emit_to_primary(
                            &audio_app,
                            "misty://cursor-recorded",
                            json!({"turn":turn,"durationMs":0}),
                        );
                        continue;
                    }
                    match audio::Recording::start(audio_app.clone(), turn) {
                        Ok(value)
                            if current(&audio_state, turn)
                                && audio_state.held.load(Ordering::SeqCst) =>
                        {
                            recording = Some((turn, Instant::now(), value))
                        }
                        Ok(_) => {
                            if current(&audio_state, turn) {
                                crate::browser::app_windows::emit_to_primary(
                                    &audio_app,
                                    "misty://cursor-recorded",
                                    json!({"turn":turn,"durationMs":0}),
                                );
                            }
                        }
                        Err(message) => {
                            if current(&audio_state, turn) {
                                error(&audio_app, turn, message)
                            }
                        }
                    }
                }
                Ok((_, false)) | Err(mpsc::RecvTimeoutError::Timeout)
                    if timed_out || !audio_state.held.load(Ordering::SeqCst) =>
                {
                    if timed_out {
                        audio_state.held.store(false, Ordering::SeqCst);
                    }
                    if let Some((turn, _, record)) = recording.take() {
                        let (sequence, pcm, duration) = record.finish();
                        if current(&audio_state, turn) {
                            if !pcm.is_empty() {
                                crate::browser::app_windows::emit_to_primary(
                                    &audio_app,
                                    "misty://cursor-audio",
                                    json!({"turn":turn,"sequence":sequence,"audio":STANDARD.encode(pcm)}),
                                );
                            }
                            crate::browser::app_windows::emit_to_primary(
                                &audio_app,
                                "misty://cursor-recorded",
                                json!({"turn":turn,"durationMs":duration}),
                            );
                        }
                    } else if let Ok((turn, false)) = event {
                        if current(&audio_state, turn) {
                            crate::browser::app_windows::emit_to_primary(
                                &audio_app,
                                "misty://cursor-recorded",
                                json!({"turn":turn,"durationMs":0}),
                            );
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                _ => {}
            }
        }
    });
    std::thread::spawn(move || {
        let mut topology = Instant::now();
        let mut front = Instant::now()
            .checked_sub(FRONT_EVERY)
            .unwrap_or_else(Instant::now);
        loop {
            if state.enabled.load(Ordering::SeqCst) {
                if front.elapsed() >= FRONT_EVERY {
                    front = Instant::now();
                    let (displays, overlays) = {
                        let data = state.data.lock().unwrap();
                        (data.displays.clone(), data.overlays.clone())
                    };
                    let full = platform::foreground_window(&overlays)
                        .is_some_and(|window| fills_a_display(&window, &displays));
                    state.fullscreen.store(full, Ordering::SeqCst);
                }
                if let Some((x, y)) = platform::cursor() {
                    if state.held.load(Ordering::SeqCst) {
                        let mut trail = state.trail.lock().unwrap();
                        let moved = trail
                            .last()
                            .is_none_or(|(lx, ly)| (x - lx).hypot(y - ly) >= 2.0);
                        if moved && trail.len() < TRAIL_POINTS {
                            trail.push((x, y));
                        }
                    }
                    let displays = state.data.lock().unwrap().displays.clone();
                    let payload = json!({
                        "x": x,
                        "y": y,
                        "displays": displays,
                        "typing": crate::voice::hold_to_talk::typing(),
                        "dragging": platform::button_held(),
                        "fullscreen": state.fullscreen.load(Ordering::SeqCst),
                        "cursorShown": platform::cursor_shown(),
                    });
                    for (label, w) in app.webview_windows() {
                        if label.starts_with(PREFIX) && label != "misty-cursor-controls" {
                            let _ = w.emit("misty://cursor-sample", &payload);
                        }
                    }
                }
                if topology.elapsed() > Duration::from_secs(2) {
                    topology = Instant::now();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = rebuild(&app).await;
                    });
                }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}

const FRONT_EVERY: Duration = Duration::from_millis(500);

fn fills_a_display(window: &platform::ForegroundWindow, displays: &[Display]) -> bool {
    displays.iter().any(|d| {
        (window.x - d.x).abs() <= 1.
            && (window.y - d.y).abs() <= 1.
            && window.width >= d.width - 1.
            && window.height >= d.height - 1.
    })
}
