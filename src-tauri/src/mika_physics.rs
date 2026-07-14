use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, PhysicalPosition, State, WebviewWindow};

const MIKA_WINDOW_LABEL: &str = "misty-bot-cloud-folder";
const PHYSICS_TICK: Duration = Duration::from_millis(16);
const MAX_FRAME_SECONDS: f64 = 0.032;
const REFERENCE_FRAME_SECONDS: f64 = 0.016;
const DRAG_VELOCITY_MULTIPLIER: f64 = 2.0;
const DAMPING_PER_REFERENCE_FRAME: f64 = 0.85;
const EDGE_BOUNCE: f64 = 0.48;
const STOP_SPEED: f64 = 65.0;
const MAX_MOMENTUM_DURATION: Duration = Duration::from_millis(800);
const VELOCITY_SAMPLE_WINDOW: Duration = Duration::from_millis(120);
const MAX_RELEASE_SPEED: f64 = 3_600.0;
const VELOCITY_EVENT: &str = "mika-native-physics-velocity";

pub struct MikaPhysicsState {
    generation: Arc<AtomicU64>,
}

impl Default for MikaPhysicsState {
    fn default() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[derive(Clone, Copy)]
struct CursorSample {
    x: f64,
    y: f64,
    captured_at: Instant,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MikaVelocity {
    velocity_x: f64,
    velocity_y: f64,
}

#[tauri::command]
pub async fn start_mika_drag(
    window: WebviewWindow,
    state: State<'_, MikaPhysicsState>,
) -> Result<(), String> {
    if window.label() != MIKA_WINDOW_LABEL {
        return Err("Mika drag is only available from the Mika overlay".to_string());
    }

    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let tracker = spawn_cursor_tracker();

    let drag_result = window.start_dragging().map_err(|error| error.to_string());
    let samples = tauri::async_runtime::spawn_blocking(move || tracker.join())
        .await
        .map_err(|error| format!("Mika cursor tracking task failed: {error}"))?
        .map_err(|_| "Mika cursor tracking stopped unexpectedly".to_string())?;
    drag_result?;

    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let (velocity_x, velocity_y) = release_velocity(&samples, scale_factor);
    if velocity_x.hypot(velocity_y) < STOP_SPEED {
        emit_velocity(&window, 0.0, 0.0);
        return Ok(());
    }

    let generation_counter = window.state::<MikaPhysicsState>().generation.clone();
    let state_generation = generation_counter.load(Ordering::SeqCst);
    if state_generation != generation {
        return Ok(());
    }
    tauri::async_runtime::spawn(run_momentum(
        window,
        generation_counter,
        generation,
        velocity_x,
        velocity_y,
    ));
    Ok(())
}

#[tauri::command]
pub fn cancel_mika_momentum(window: WebviewWindow, state: State<'_, MikaPhysicsState>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
    emit_velocity(&window, 0.0, 0.0);
}

#[cfg(target_os = "macos")]
fn spawn_cursor_tracker() -> std::thread::JoinHandle<Vec<CursorSample>> {
    std::thread::spawn(move || {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        let Ok(source) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState) else {
            return Vec::new();
        };
        let mut samples = Vec::new();
        loop {
            if let Ok(event) = CGEvent::new(source.clone()) {
                let point = event.location();
                samples.push(CursorSample {
                    x: point.x,
                    y: point.y,
                    captured_at: Instant::now(),
                });
                let cutoff = Instant::now() - VELOCITY_SAMPLE_WINDOW - Duration::from_millis(40);
                while samples.len() > 2 && samples[0].captured_at < cutoff {
                    samples.remove(0);
                }
            }
            if !left_mouse_button_is_pressed() {
                break;
            }
            std::thread::sleep(PHYSICS_TICK);
        }
        samples
    })
}

#[cfg(not(target_os = "macos"))]
fn spawn_cursor_tracker() -> std::thread::JoinHandle<Vec<CursorSample>> {
    std::thread::spawn(Vec::new)
}

#[cfg(target_os = "macos")]
fn left_mouse_button_is_pressed() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
    }

    // CombinedSessionState = 0 and the primary/left mouse button = 0.
    unsafe { CGEventSourceButtonState(0, 0) }
}

fn release_velocity(samples: &[CursorSample], scale_factor: f64) -> (f64, f64) {
    let Some(newest) = samples.last() else {
        return (0.0, 0.0);
    };
    let oldest = samples
        .iter()
        .find(|sample| {
            newest.captured_at.duration_since(sample.captured_at) <= VELOCITY_SAMPLE_WINDOW
        })
        .unwrap_or(newest);
    let elapsed = newest
        .captured_at
        .duration_since(oldest.captured_at)
        .as_secs_f64();
    if elapsed <= f64::EPSILON {
        return (0.0, 0.0);
    }

    let multiplier = scale_factor * DRAG_VELOCITY_MULTIPLIER;
    let velocity_x =
        ((newest.x - oldest.x) / elapsed * multiplier).clamp(-MAX_RELEASE_SPEED, MAX_RELEASE_SPEED);
    let velocity_y =
        ((newest.y - oldest.y) / elapsed * multiplier).clamp(-MAX_RELEASE_SPEED, MAX_RELEASE_SPEED);
    (velocity_x, velocity_y)
}

async fn run_momentum(
    window: WebviewWindow,
    generation_counter: Arc<AtomicU64>,
    generation: u64,
    mut velocity_x: f64,
    mut velocity_y: f64,
) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let work_area = monitor.work_area();
    let min_x = work_area.position.x as f64;
    let min_y = work_area.position.y as f64;
    let max_x = (work_area.position.x + work_area.size.width as i32 - size.width as i32)
        .max(work_area.position.x) as f64;
    let max_y = (work_area.position.y + work_area.size.height as i32 - size.height as i32)
        .max(work_area.position.y) as f64;
    let mut x = position.x as f64;
    let mut y = position.y as f64;
    let started_at = Instant::now();
    let mut previous_tick = started_at;

    loop {
        tokio::time::sleep(PHYSICS_TICK).await;
        if generation_counter.load(Ordering::SeqCst) != generation {
            break;
        }
        let now = Instant::now();
        let elapsed = now
            .duration_since(previous_tick)
            .as_secs_f64()
            .clamp(0.0, MAX_FRAME_SECONDS);
        previous_tick = now;
        x += velocity_x * elapsed;
        y += velocity_y * elapsed;

        if x < min_x || x > max_x {
            x = x.clamp(min_x, max_x);
            velocity_x = -velocity_x * EDGE_BOUNCE;
        }
        if y < min_y || y > max_y {
            y = y.clamp(min_y, max_y);
            velocity_y = -velocity_y * EDGE_BOUNCE;
        }

        let damping = DAMPING_PER_REFERENCE_FRAME.powf(elapsed / REFERENCE_FRAME_SECONDS);
        velocity_x *= damping;
        velocity_y *= damping;
        emit_velocity(&window, velocity_x, velocity_y);
        if !set_position_if_current(
            &window,
            generation_counter.clone(),
            generation,
            PhysicalPosition::new(x.round() as i32, y.round() as i32),
        )
        .await
        {
            break;
        }
        if started_at.elapsed() >= MAX_MOMENTUM_DURATION
            || velocity_x.hypot(velocity_y) < STOP_SPEED
        {
            break;
        }
    }
    emit_velocity(&window, 0.0, 0.0);
}

async fn set_position_if_current(
    window: &WebviewWindow,
    generation_counter: Arc<AtomicU64>,
    generation: u64,
    position: PhysicalPosition<i32>,
) -> bool {
    let window = window.clone();
    let (completed_tx, completed_rx) = tokio::sync::oneshot::channel();
    if window
        .clone()
        .run_on_main_thread(move || {
            let applied = if generation_counter.load(Ordering::SeqCst) == generation {
                window.set_position(position).is_ok()
            } else {
                false
            };
            let _ = completed_tx.send(applied);
        })
        .is_err()
    {
        return false;
    }
    completed_rx.await.unwrap_or(false)
}

fn emit_velocity(window: &WebviewWindow, velocity_x: f64, velocity_y: f64) {
    let _ = window.emit(
        VELOCITY_EVENT,
        MikaVelocity {
            velocity_x,
            velocity_y,
        },
    );
}
