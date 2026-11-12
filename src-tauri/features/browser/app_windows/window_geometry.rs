// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Each window's size, place, and whether it was maximized or full screen, kept with the window
//! in the registry's list of open windows (`registry::OpenWindow`), so a restored window comes
//! back where it was.
//!
//! - Maximized or full screen never overwrites the normal size: while maximized the window
//!   measures the whole screen, and keeping that would lose the size to return to.
//! - A saved place that no screen shows enough of is dropped (a second screen unplugged, a
//!   resolution changed), and the window opens at its default size, centered.
//! - macOS keeps points, which are one grid across screens of different scale; Windows and
//!   Linux keep physical pixels, which already are.
//! - Moving and resizing only mark the window; it is measured and saved half a second after
//!   the last change, and at once when it closes or Misty quits.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, Runtime, Window};

mod placement;
#[cfg(test)]
mod tests;

pub use placement::SavedGeometry;
use placement::*;

/// A window measured: its geometry in record units, and whether it is maximized or full screen.
type Measured = (Rect, bool, bool);

// ---------------------------------------------------------------------------
// Tracking open windows
// ---------------------------------------------------------------------------

struct Tracker {
    /// Measures the window; nothing once it is gone. Held as a closure so any runtime's window fits.
    measure: std::sync::Arc<dyn Fn() -> Option<Measured> + Send + Sync>,
    /// Applies maximize or full screen.
    flags: std::sync::Arc<dyn Fn((bool, bool)) + Send + Sync>,
    window_id: String,
    state: SavedGeometry,
    dirty: bool,
    last_change: Instant,
    /// Maximize or full screen waiting for the window to be shown (macOS needs it visible).
    pending: Option<(bool, bool)>,
}

/// Open windows, by label.
static TRACKERS: Mutex<BTreeMap<String, Tracker>> = Mutex::new(BTreeMap::new());
/// The last record of every window this launch has seen, by window id, including closed ones:
/// a window that takes over a closed one's tabs takes its place too.
static KNOWN: Mutex<BTreeMap<String, SavedGeometry>> = Mutex::new(BTreeMap::new());

fn trackers() -> std::sync::MutexGuard<'static, BTreeMap<String, Tracker>> {
    TRACKERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn known() -> std::sync::MutexGuard<'static, BTreeMap<String, SavedGeometry>> {
    KNOWN
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The record to save for a window id, for `registry::save`.
pub(crate) fn geometry_for(window_id: &str) -> Option<SavedGeometry> {
    known().get(window_id).cloned()
}

/// Remembers what the last launch saved, so a window reopened under that id finds it.
pub(crate) fn remember(window_id: &str, geometry: Option<&SavedGeometry>) {
    if let Some(geometry) = geometry.filter(|state| state.is_plausible()) {
        known().insert(window_id.to_owned(), geometry.clone());
    }
}

/// The window's inner size and outer position in record units.
fn measure<R: Runtime>(window: &Window<R>) -> Option<Rect> {
    let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) else {
        return None;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    Some(to_record_units(
        Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        scale_factor,
        LOGICAL_UNITS,
    ))
}

/// Places the window in record units: position first, then size, so the system doesn't fit
/// the new size to the old screen.
fn place<R: Runtime>(window: &Window<R>, rect: Rect) -> Result<(), String> {
    if LOGICAL_UNITS {
        window
            .set_position(LogicalPosition::new(f64::from(rect.x), f64::from(rect.y)))
            .map_err(|e| e.to_string())?;
        window
            .set_size(LogicalSize::new(
                f64::from(rect.width),
                f64::from(rect.height),
            ))
            .map_err(|e| e.to_string())
    } else {
        window
            .set_position(PhysicalPosition::new(rect.x, rect.y))
            .map_err(|e| e.to_string())?;
        window
            .set_size(PhysicalSize::new(rect.width, rect.height))
            .map_err(|e| e.to_string())
    }
}

/// The screens there are, the main one first.
fn displays<R: Runtime>(window: &Window<R>) -> Vec<Display> {
    let display = |monitor: &tauri::Monitor| {
        let area = monitor.work_area();
        let work_area = Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        };
        display_from(work_area, monitor.scale_factor(), LOGICAL_UNITS)
    };
    let mut displays: Vec<Display> = window
        .primary_monitor()
        .ok()
        .flatten()
        .iter()
        .map(display)
        .collect();
    for monitor in window.available_monitors().unwrap_or_default() {
        let next = display(&monitor);
        if !displays.iter().any(|known| known.area == next.area) {
            displays.push(next);
        }
    }
    displays
}

/// Measures the window now, keeping the normal geometry while maximized. Gone windows (after
/// `Destroyed`) give nothing, and the record stays as it was.
fn sample(
    measure: &(dyn Fn() -> Option<Measured> + Send + Sync),
    previous: &SavedGeometry,
) -> Option<SavedGeometry> {
    let (rect, maximized, fullscreen) = measure()?;
    Some(state_after_event(
        previous,
        (rect.width, rect.height),
        (rect.x, rect.y),
        maximized,
        fullscreen,
    ))
}

/// Places a new window where its record says, before it is first shown, and starts tracking
/// it. Maximize and full screen wait for the window to show on macOS, where they need it.
pub(crate) fn apply_and_track<R: Runtime>(window: &Window<R>, window_id: &str) {
    let saved = geometry_for(window_id);
    let resolution = resolve(saved.as_ref(), &displays(window));
    let rect = match resolution.placement {
        Placement::Restore(rect) | Placement::Default(rect) => rect,
    };
    let _ = place(window, rect);
    let wanted = (resolution.maximized, resolution.fullscreen);
    let pending = if cfg!(target_os = "macos") {
        (wanted != (false, false)).then_some(wanted)
    } else {
        apply_flags(window, wanted);
        None
    };
    let initial = saved
        .filter(|state| state.is_plausible())
        .map(|state| SavedGeometry {
            maximized: resolution.maximized,
            fullscreen: resolution.fullscreen,
            ..state
        })
        .unwrap_or(SavedGeometry {
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y,
            maximized: false,
            fullscreen: false,
        });
    let measured = window.clone();
    let flagged = window.clone();
    trackers().insert(
        window.label().to_owned(),
        Tracker {
            measure: std::sync::Arc::new(move || {
                Some((
                    measure(&measured)?,
                    measured.is_maximized().unwrap_or(false),
                    measured.is_fullscreen().unwrap_or(false),
                ))
            }),
            flags: std::sync::Arc::new(move |wanted| apply_flags(&flagged, wanted)),
            window_id: window_id.to_owned(),
            state: initial,
            dirty: false,
            last_change: Instant::now(),
            pending,
        },
    );
    ensure_writer();
}

fn apply_flags<R: Runtime>(window: &Window<R>, (maximized, fullscreen): (bool, bool)) {
    if fullscreen {
        let _ = window.set_fullscreen(true);
    } else if maximized {
        let _ = window.maximize();
    }
}

/// The window was shown: apply a maximize or full screen that had to wait for it.
pub(crate) fn shown(label: &str) {
    let job = {
        let mut trackers = trackers();
        trackers.get_mut(label).and_then(|tracker| {
            let flags = tracker.pending.take()?;
            Some((std::sync::Arc::clone(&tracker.flags), flags))
        })
    };
    if let Some((apply, flags)) = job {
        apply(flags);
    }
}

/// A move or resize: measured and saved once things settle.
pub(crate) fn mark_dirty(label: &str) {
    if let Some(tracker) = trackers().get_mut(label) {
        tracker.dirty = true;
        tracker.last_change = Instant::now();
    }
}

/// Measures a window that is about to close and keeps its record.
pub(crate) fn flush(label: &str) {
    let job = trackers().get(label).map(|tracker| {
        (
            std::sync::Arc::clone(&tracker.measure),
            tracker.state.clone(),
        )
    });
    let Some((measure, previous)) = job else {
        return;
    };
    let next = sample(measure.as_ref(), &previous);
    let mut trackers = trackers();
    if let Some(tracker) = trackers.get_mut(label) {
        if let Some(next) = next.filter(|_| tracker.state == previous) {
            tracker.state = next;
        }
        tracker.dirty = false;
        known().insert(tracker.window_id.clone(), tracker.state.clone());
    }
}

/// Stops tracking a closed window. Its record stays known for a window that takes its place.
pub(crate) fn forget(label: &str) {
    trackers().remove(label);
}

/// Measures every window, as Misty quits.
pub(crate) fn flush_all() {
    let labels: Vec<String> = trackers().keys().cloned().collect();
    for label in labels {
        flush(&label);
    }
}

/// Saves windows whose last change has settled. Window calls wait on the main thread, so no
/// lock is held while measuring.
fn settle() -> bool {
    type Due = (
        String,
        std::sync::Arc<dyn Fn() -> Option<Measured> + Send + Sync>,
        SavedGeometry,
    );
    let due: Vec<Due> = trackers()
        .iter()
        .filter(|(_, tracker)| tracker.dirty && tracker.last_change.elapsed() >= DEBOUNCE)
        .map(|(label, tracker)| {
            (
                label.clone(),
                std::sync::Arc::clone(&tracker.measure),
                tracker.state.clone(),
            )
        })
        .collect();
    let mut changed = false;
    for (label, measure, previous) in due {
        let Some(next) = sample(measure.as_ref(), &previous) else {
            continue;
        };
        let mut trackers = trackers();
        let Some(tracker) = trackers.get_mut(&label) else {
            continue;
        };
        // A change that arrived while measuring makes this sample stale; the next round redoes it.
        if tracker.state != previous || tracker.last_change.elapsed() < DEBOUNCE {
            continue;
        }
        tracker.dirty = false;
        if next != previous {
            tracker.state = next.clone();
            known().insert(tracker.window_id.clone(), next);
            changed = true;
        }
    }
    changed
}

fn ensure_writer() {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        let _ = std::thread::Builder::new()
            .name("window-geometry".into())
            .spawn(|| loop {
                std::thread::sleep(Duration::from_millis(200));
                if settle() {
                    if let Ok(state) = super::lock_registry() {
                        super::save(&state);
                    }
                }
            });
    });
}
