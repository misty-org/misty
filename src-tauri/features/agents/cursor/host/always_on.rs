//! Always On: Tutor listens without the talk keys. Tapping Control three times turns it on or off.
//! While it's on, the microphone stays open and a turn starts when the person starts talking and
//! ends when they've stopped for a moment, exactly as if they had held the talk keys that long:
//! the same `Shortcut::Held` events go through the same turn path. The last half second before
//! the voice was noticed goes with the turn (`CursorCompanionState::preroll`), so the first word
//! isn't lost to the time it takes to notice it.
//!
//! Misty never takes its own voice for the person's: while it reads aloud through the speakers,
//! nothing starts a turn. Through headphones or earbuds the microphone can't hear it, so the
//! person may talk over it, which stops it as pressing the talk keys does.
use super::*;
use std::collections::VecDeque;
use voice_capture::{AudioSource, Capture};

/// 16 kHz mono, the capture's rate.
const RATE: usize = 16_000;
/// The audio judged at a time: 30 ms.
const FRAME: usize = RATE * 30 / 1000;
/// How much is kept from before the voice was noticed.
const PREROLL: usize = RATE / 2;
/// Frames of voice before a turn starts (120 ms), so a click or a cough doesn't start one.
const ONSET_FRAMES: usize = 4;
/// Frames of quiet before a turn ends (900 ms).
const QUIET_FRAMES: usize = 30;
/// After a turn, a moment before the next can start, so its tail can't start another.
const REST: Duration = Duration::from_millis(800);
/// How far over the room's own noise a voice must be, in decibels, and the least it may be.
const OVER_NOISE_DB: f32 = 12.0;
const LEAST_DB: f32 = -45.0;

/// Starts the listening thread; it does nothing until Always On is turned on.
pub(super) fn start(app: AppHandle, state: Arc<CursorCompanionState>, tx: mpsc::Sender<Shortcut>) {
    std::thread::spawn(move || listen(app, state, tx));
}

/// Turns Always On on or off, and says so to the main window.
pub(super) fn toggle(app: &AppHandle, state: &CursorCompanionState) {
    let on = !state.always_on.fetch_xor(true, Ordering::SeqCst);
    let _ = crate::browser::app_windows::emit_to_primary(
        app,
        "misty://cursor-always-on",
        json!({ "on": on }),
    );
}

struct Open {
    _capture: Capture,
    samples: Arc<Mutex<VecDeque<i16>>>,
    /// Samples not yet judged.
    fresh: Arc<Mutex<Vec<i16>>>,
    failed: Arc<AtomicBool>,
}

fn open() -> Option<Open> {
    super::platform::microphone_access().ok()?;
    let samples = Arc::new(Mutex::new(VecDeque::with_capacity(PREROLL * 2)));
    let fresh = Arc::new(Mutex::new(Vec::new()));
    let failed = Arc::new(AtomicBool::new(false));
    let (kept, judged, broken) = (samples.clone(), fresh.clone(), failed.clone());
    let capture = voice_capture::start(
        AudioSource::Mic,
        move |chunk| {
            if let Ok(mut kept) = kept.lock() {
                kept.extend(chunk.samples.iter().copied());
                let over = kept.len().saturating_sub(PREROLL);
                kept.drain(..over);
            }
            if let Ok(mut judged) = judged.lock() {
                judged.extend(chunk.samples.iter().copied());
            }
        },
        move |_| broken.store(true, Ordering::SeqCst),
    )
    .ok()?;
    Some(Open {
        _capture: capture,
        samples,
        fresh,
        failed,
    })
}

fn decibels(frame: &[i16]) -> f32 {
    let sum: f32 = frame.iter().map(|s| (*s as f32 / 32768.0).powi(2)).sum();
    let rms = (sum / frame.len().max(1) as f32).sqrt();
    20.0 * rms.max(1e-6).log10()
}

fn listen(app: AppHandle, state: Arc<CursorCompanionState>, tx: mpsc::Sender<Shortcut>) {
    let mut open: Option<Open> = None;
    let mut floor = -50.0f32;
    let mut voiced = 0usize;
    let mut quiet = 0usize;
    // Whether the turn being heard now is one Always On started.
    let mut hearing = false;
    let mut rested = Instant::now();
    // When the turn being heard began: the events thread sets `held` a moment after.
    let mut began = Instant::now();
    loop {
        let wanted = state.always_on.load(Ordering::SeqCst) && state.enabled.load(Ordering::SeqCst);
        if !wanted {
            if hearing {
                let _ = tx.send(Shortcut::Held(false));
                hearing = false;
            }
            open = None;
            std::thread::sleep(Duration::from_millis(150));
            continue;
        }
        if open.as_ref().is_some_and(|open| open.failed.load(Ordering::SeqCst)) {
            open = None;
        }
        if open.is_none() {
            open = self::open();
            if open.is_none() {
                // No microphone now: try again in a moment rather than spin.
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
        }
        std::thread::sleep(Duration::from_millis(30));
        let Some(mic) = open.as_ref() else { continue };
        let fresh = {
            let mut pending = mic.fresh.lock().unwrap();
            // Whole frames are judged now; the rest waits for the next pass.
            let whole = pending.len() / FRAME * FRAME;
            pending.drain(..whole).collect::<Vec<i16>>()
        };
        // The person holding the talk keys themselves runs the turn as usual.
        let keys = state.held.load(Ordering::SeqCst) && !hearing;
        // Misty's own voice through the speakers would be heard as the person's.
        let deaf = !hearing
            && crate::voice::speech::speaking_now(&app)
            && !crate::voice::speech::output_private();
        for frame in fresh.chunks_exact(FRAME) {
            let level = decibels(frame);
            let voice = level > (floor + OVER_NOISE_DB).max(LEAST_DB);
            // The room's noise: follows quiet down at once, and up only slowly.
            if !voice {
                floor = if level < floor { level } else { floor + (level - floor) * 0.02 };
            }
            if hearing {
                quiet = if voice { 0 } else { quiet + 1 };
                // The turn ended some other way (its minute ran out, the person pressed the keys).
                let ended = !state.held.load(Ordering::SeqCst)
                    && began.elapsed() > Duration::from_millis(500);
                if ended || quiet >= QUIET_FRAMES {
                    if state.held.load(Ordering::SeqCst) {
                        let _ = tx.send(Shortcut::Held(false));
                    }
                    hearing = false;
                    voiced = 0;
                    rested = Instant::now();
                }
                continue;
            }
            voiced = if voice { voiced + 1 } else { 0 };
            if voiced >= ONSET_FRAMES && !keys && !deaf && rested.elapsed() >= REST {
                *state.preroll.lock().unwrap() = mic.samples.lock().unwrap().iter().copied().collect();
                hearing = true;
                quiet = 0;
                began = Instant::now();
                let _ = tx.send(Shortcut::Held(true));
            }
        }
    }
}
