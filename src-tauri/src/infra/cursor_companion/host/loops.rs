//! The threads a running companion keeps: shortcut and audio events, and the cursor sampler.
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
            // TEMP: chasing "the shortcut works once". Remove with the other [companion] lines.
            if let Shortcut::Held(held) = &event {
                eprintln!(
                    "[companion] shortcut held={held} enabled={} hostHeld={} turn={}",
                    events_state.enabled.load(Ordering::SeqCst),
                    events_state.held.load(Ordering::SeqCst),
                    events_state.turn.load(Ordering::SeqCst)
                );
            }
            if !events_state.enabled.load(Ordering::SeqCst) {
                continue;
            }
            match event {
                Shortcut::KeyboardActivity => {
                    events_state
                        .keyboard_activity
                        .fetch_add(1, Ordering::Relaxed);
                }
                Shortcut::Click(x, y) => forward_click(&events_app, &events_state, x, y),
                Shortcut::Held(held) => {
                    if events_state.held.swap(held, Ordering::SeqCst) == held {
                        continue;
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
                    let _ = crate::infra::space_windows::emit_to_primary(
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
                        let _ = crate::infra::space_windows::emit_to_primary(
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
                        let _ = crate::infra::space_windows::emit_to_primary(
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
                                let _ = crate::infra::space_windows::emit_to_primary(
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
                                let _ = crate::infra::space_windows::emit_to_primary(
                                    &audio_app,
                                    "misty://cursor-audio",
                                    json!({"turn":turn,"sequence":sequence,"audio":STANDARD.encode(pcm)}),
                                );
                            }
                            let _ = crate::infra::space_windows::emit_to_primary(
                                &audio_app,
                                "misty://cursor-recorded",
                                json!({"turn":turn,"durationMs":duration}),
                            );
                        }
                    } else if let Ok((turn, false)) = event {
                        if current(&audio_state, turn) {
                            let _ = crate::infra::space_windows::emit_to_primary(
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
        loop {
            if state.enabled.load(Ordering::SeqCst) {
                if let Some((x, y)) = platform::cursor() {
                    let displays = state.data.lock().unwrap().displays.clone();
                    let payload = json!({"x":x,"y":y,"displays":displays,"keyboardActivity":state.keyboard_activity.load(Ordering::Relaxed)});
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
