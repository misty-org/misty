// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Where a window opens: its saved record checked against the screens there are now.

use super::*;

/// The window's size from `tauri.conf.json`, in logical pixels.
pub(super) const DEFAULT_WIDTH: f64 = 1280.0;
pub(super) const DEFAULT_HEIGHT: f64 = 820.0;
/// Its `minWidth` and `minHeight`.
pub(super) const MIN_WIDTH: f64 = 640.0;
pub(super) const MIN_HEIGHT: f64 = 420.0;
pub(super) const DEBOUNCE: Duration = Duration::from_millis(500);
/// How much of a screen a saved window must cover: this many pixels each way, and a fifth of
/// its area. Less means that screen is gone.
pub(super) const MIN_INTERSECT_PX: i64 = 120;
pub(super) const MIN_INTERSECT_RATIO: f64 = 0.2;
/// Anything larger than this is a damaged record.
pub(super) const MAX_DIMENSION: u32 = 20_000;

/// The units records use: points on macOS, physical pixels elsewhere (see the module notes).
pub(super) const LOGICAL_UNITS: bool = cfg!(target_os = "macos");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub(super) fn right(&self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }
    pub(super) fn bottom(&self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
    pub(super) fn area(&self) -> f64 {
        f64::from(self.width) * f64::from(self.height)
    }
    /// The overlap's width and height, never below zero.
    pub(super) fn intersection(&self, other: &Rect) -> (i64, i64) {
        let w = self.right().min(other.right()) - i64::from(self.x).max(i64::from(other.x));
        let h = self.bottom().min(other.bottom()) - i64::from(self.y).max(i64::from(other.y));
        (w.max(0), h.max(0))
    }
}

/// A screen's work area, and how many record units one logical pixel is on it: its own scale
/// in physical pixels, always 1 in points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Display {
    pub area: Rect,
    pub scale: f64,
}

pub(super) fn valid_scale(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

/// A rectangle Tauri reports in physical pixels, in the units records use.
pub(super) fn to_record_units(rect: Rect, scale_factor: f64, logical: bool) -> Rect {
    if !logical {
        return rect;
    }
    let scale = valid_scale(scale_factor);
    let points = |value: f64| (value / scale).round();
    Rect {
        x: points(f64::from(rect.x)) as i32,
        y: points(f64::from(rect.y)) as i32,
        width: points(f64::from(rect.width)) as u32,
        height: points(f64::from(rect.height)) as u32,
    }
}

pub(super) fn display_from(work_area: Rect, scale_factor: f64, logical: bool) -> Display {
    Display {
        area: to_record_units(work_area, scale_factor, logical),
        scale: if logical {
            1.0
        } else {
            valid_scale(scale_factor)
        },
    }
}

/// What is kept for a window: its inner size and outer position, in record units.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedGeometry {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub fullscreen: bool,
}

impl SavedGeometry {
    pub(super) fn rect(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }

    pub(super) fn is_plausible(&self) -> bool {
        self.width >= 1
            && self.height >= 1
            && self.width <= MAX_DIMENSION
            && self.height <= MAX_DIMENSION
            && self.x.unsigned_abs() < MAX_DIMENSION
            && self.y.unsigned_abs() < MAX_DIMENSION
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Placement {
    /// A usable record: its geometry.
    Restore(Rect),
    /// No record, a damaged one, or one on a screen that's gone: the default size centered on
    /// the main screen, worked out here rather than left to the system, which places windows
    /// unreliably across screens of different scale.
    Default(Rect),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Resolution {
    pub placement: Placement,
    pub maximized: bool,
    pub fullscreen: bool,
}

/// The default size on the main screen, shrunk to fit its work area, centered.
pub(super) fn default_placement(displays: &[Display]) -> Rect {
    let scale = displays
        .first()
        .map_or(1.0, |primary| primary.scale)
        .max(1.0);
    let width = (DEFAULT_WIDTH * scale).round() as u32;
    let height = (DEFAULT_HEIGHT * scale).round() as u32;
    let Some(primary) = displays.first().map(|display| display.area) else {
        return Rect {
            x: 0,
            y: 0,
            width,
            height,
        };
    };
    let width = width.min(primary.width);
    let height = height.min(primary.height);
    Rect {
        x: primary.x + (i64::from(primary.width) - i64::from(width)).max(0) as i32 / 2,
        y: primary.y + (i64::from(primary.height) - i64::from(height)).max(0) as i32 / 2,
        width,
        height,
    }
}

impl Resolution {
    pub(super) fn fallback(displays: &[Display]) -> Self {
        Self {
            placement: Placement::Default(default_placement(displays)),
            maximized: false,
            fullscreen: false,
        }
    }
}

/// Whether a screen shows enough of the rectangle; a window restored where none does could
/// never be seen or dragged back.
pub(super) fn visible_enough(rect: &Rect, displays: &[Display]) -> bool {
    displays.iter().any(|display| {
        let (w, h) = rect.intersection(&display.area);
        if w < MIN_INTERSECT_PX || h < MIN_INTERSECT_PX {
            return false;
        }
        let area = f64::from(w as u32) * f64::from(h as u32);
        area >= rect.area() * MIN_INTERSECT_RATIO
    })
}

/// Fits a restored size between the minimum and the screen it mostly sits on. The minimum is
/// scaled by that screen's own factor, since the system enforces it there; the work area wins
/// over the minimum, so a window is never restored larger than its screen.
pub(super) fn clamp_size(rect: Rect, displays: &[Display]) -> Rect {
    let target = displays
        .iter()
        .max_by_key(|display| {
            let (w, h) = rect.intersection(&display.area);
            w.saturating_mul(h)
        })
        .copied();
    let scale = target.map_or(1.0, |display| display.scale).max(1.0);
    let min_w = (MIN_WIDTH * scale).round() as u32;
    let min_h = (MIN_HEIGHT * scale).round() as u32;
    let (max_w, max_h) = target
        .map(|display| (display.area.width, display.area.height))
        .unwrap_or((MAX_DIMENSION, MAX_DIMENSION));
    let clamp_axis = |value: u32, min: u32, max: u32| value.max(min.min(max)).min(max);
    Rect {
        width: clamp_axis(rect.width, min_w, max_w),
        height: clamp_axis(rect.height, min_h, max_h),
        ..rect
    }
}

/// Where a window opens, from its record and the screens there are now. `displays[0]` is the
/// main screen.
pub(crate) fn resolve(saved: Option<&SavedGeometry>, displays: &[Display]) -> Resolution {
    let Some(saved) = saved.filter(|state| state.is_plausible()) else {
        return Resolution::fallback(displays);
    };
    // Without any screen to check against, the window isn't put somewhere unknown either.
    if displays.is_empty() || !visible_enough(&saved.rect(), displays) {
        return Resolution::fallback(displays);
    }
    Resolution {
        placement: Placement::Restore(clamp_size(saved.rect(), displays)),
        maximized: saved.maximized,
        fullscreen: saved.fullscreen,
    }
}

/// The record after a change. While maximized or full screen only the flags are kept, never the
/// screen-sized geometry.
pub(crate) fn state_after_event(
    previous: &SavedGeometry,
    size: (u32, u32),
    position: (i32, i32),
    maximized: bool,
    fullscreen: bool,
) -> SavedGeometry {
    let mut next = previous.clone();
    if !maximized && !fullscreen && size.0 > 0 && size.1 > 0 {
        next.width = size.0;
        next.height = size.1;
        next.x = position.0;
        next.y = position.1;
    }
    next.maximized = maximized;
    next.fullscreen = fullscreen;
    next
}
