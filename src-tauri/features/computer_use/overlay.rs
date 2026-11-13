// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The virtual cursor: a small transparent, click-through, always-on-top window that shows where an
//! engine is about to act while it controls the screen. The driver runs in this process, so each
//! action's target arrives here directly; the cursor glides to it and hides once the run has been
//! quiet for a while or screen control ends.

use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

pub(crate) const LABEL: &str = "misty-computer-cursor";
const SIZE: f64 = 64.0;
/// The pointer's tip inside the 64px window (src/app/computer-cursor.html).
const HOTSPOT: (f64, f64) = (22.0, 17.0);
/// Fast but capped, so a far jump reads as motion, not a teleport.
const GLIDE_PX_PER_SEC: f64 = 2000.0;
const GLIDE_MAX_SECS: f64 = 0.5;
/// A run that stops acting without saying so leaves no cursor behind.
const IDLE_HIDE_SECS: u64 = 30;

struct Inner {
    visible: bool,
    pos: (f64, f64),
    target: (f64, f64),
    /// Bumped on every new target or hide; an older glide stops itself.
    generation: u64,
    last_event: Instant,
}

static INNER: LazyLock<Mutex<Inner>> = LazyLock::new(|| {
    Mutex::new(Inner {
        visible: false,
        pos: (0.0, 0.0),
        target: (0.0, 0.0),
        generation: 0,
        last_event: Instant::now(),
    })
});
static APP: OnceLock<AppHandle> = OnceLock::new();

fn inner() -> std::sync::MutexGuard<'static, Inner> {
    INNER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let idle = {
                let inner = inner();
                inner.visible && inner.last_event.elapsed() > Duration::from_secs(IDLE_HIDE_SECS)
            };
            if idle {
                hide();
            }
        }
    });
}

/// AppKit aborts when a window is made or moved off the main thread, and actions arrive on tokio
/// threads, so every window call goes through here.
fn on_main(op: impl FnOnce() + Send + 'static) {
    if let Some(app) = APP.get() {
        let _ = app.run_on_main_thread(op);
    }
}

fn ensure_window() -> Result<(), String> {
    let app = APP.get().ok_or("The cursor window isn't set up yet.")?;
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let (send, receive) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &handle,
            LABEL,
            tauri::WebviewUrl::App("computer-cursor.html".into()),
        )
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .inner_size(SIZE, SIZE)
        .visible(false)
        .build()
        // Click-through: the cursor never takes a click meant for what it hovers.
        .map(|window| {
            #[cfg(target_os = "linux")]
            let _ = crate::agents::desktop_control::linux::overlay::prepare(&window);
            #[cfg(not(target_os = "linux"))]
            let _ = window.set_ignore_cursor_events(true);
        })
        .map_err(|error| format!("Couldn't make the cursor window: {error}"));
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .recv()
        .map_err(|_| "The cursor window never answered.".to_string())?
}

/// Moves the window's corner to a point in the driver's global coordinates.
fn place(window: &tauri::WebviewWindow, x: f64, y: f64) {
    #[cfg(target_os = "linux")]
    {
        // The driver's points are X pixels on X11, which GTK places in its own logical units.
        let scale = if crate::agents::desktop_control::linux::wayland_session() {
            1.0
        } else {
            crate::agents::desktop_control::linux::overlay::scale(window)
        };
        crate::agents::desktop_control::linux::overlay::move_to(window, x / scale, y / scale);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}

/// Shows the window above everything without taking focus.
fn present(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    crate::agents::desktop_control::linux::overlay::show(window);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window.show();
    }
}

/// Moves the cursor to a point in global logical coordinates, gliding from where it was.
pub(crate) fn show_at(x: f64, y: f64) {
    if ensure_window().is_err() {
        return;
    }
    let Some(window) = APP.get().and_then(|app| app.get_webview_window(LABEL)) else {
        return;
    };
    let target = (x - HOTSPOT.0, y - HOTSPOT.1);
    let (first_show, generation) = {
        let mut inner = inner();
        let first_show = !inner.visible;
        inner.visible = true;
        inner.target = target;
        inner.generation += 1;
        inner.last_event = Instant::now();
        if first_show {
            inner.pos = target;
        }
        (first_show, inner.generation)
    };
    if first_show {
        on_main(move || {
            place(&window, target.0, target.1);
            present(&window);
        });
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let (from, to, current) = {
                let inner = inner();
                (inner.pos, inner.target, inner.generation)
            };
            if current != generation {
                return;
            }
            let (dx, dy) = (to.0 - from.0, to.1 - from.1);
            let distance = (dx * dx + dy * dy).sqrt();
            if distance < 1.0 {
                let last = window.clone();
                on_main(move || place(&last, to.0, to.1));
                inner().pos = to;
                return;
            }
            // Ease out: a share of the remaining distance each frame.
            let total = (distance / GLIDE_PX_PER_SEC).min(GLIDE_MAX_SECS);
            let frame = 1.0 / 60.0;
            let share = (frame / total).min(1.0);
            let next = (from.0 + dx * share, from.1 + dy * share);
            let step = window.clone();
            on_main(move || place(&step, next.0, next.1));
            inner().pos = next;
            tokio::time::sleep(Duration::from_secs_f64(frame)).await;
        }
    });
}

pub(crate) fn hide() {
    {
        let mut inner = inner();
        inner.visible = false;
        inner.generation += 1;
    }
    if let Some(window) = APP.get().and_then(|app| app.get_webview_window(LABEL)) {
        on_main(move || {
            let _ = window.hide();
        });
    }
}
