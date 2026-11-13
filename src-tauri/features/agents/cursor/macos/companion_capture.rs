// Adapted from Clicky's CompanionScreenCaptureUtility.swift (MIT, Farza 2026).
// Capture for the cursor companion;
/*
MIT License

Copyright (c) 2026 Farza

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
use objc2_app_kit::NSWorkspace;
use objc2_foundation::NSRect;
use serde_json::{json, Map, Value};

use super::{
    screen_capture::{display_still, StillMessages},
    support::{macos_at_least, on_screen_windows},
};

/// Vision providers resize larger images before the model sees them (OpenAI to
/// a 768px short side, Anthropic to a 1568px long side). Labels state the sent
/// size, so a resize would shift every point; stay inside both bounds instead.
pub(crate) fn capture_scale(width: f64, height: f64) -> f64 {
    1.0_f64.min((768.0 / width.min(height)).min(1568.0 / width.max(height)))
}

/// Misty supports macOS 12; SCScreenshotManager is only available on 14+.
/// The host keeps its existing CoreGraphics still path on older systems.
fn legacy() -> Value {
    json!({ "legacy_capture": true })
}

/// Runs on Rust's blocking worker.
pub(crate) fn capture_display(display_id: u32) -> Value {
    if !macos_at_least(14, 0) {
        return legacy();
    }
    display_still(
        display_id,
        0.8,
        StillMessages {
            disconnected: "Display disconnected. Capture the screen again.",
            timeout: "Screen capture timed out. Try again.",
            no_image: "Screen capture returned no image.",
            empty: "Screen capture returned an empty image.",
        },
        |target, _filter, config| {
            // SAFETY: plain property reads and writes before the capture starts.
            unsafe {
                let (width, height) = (target.width() as f64, target.height() as f64);
                let scale = capture_scale(width, height);
                config.setWidth(((width * scale) as usize).max(1));
                config.setHeight(((height * scale) as usize).max(1));
            }
            Ok(Map::new())
        },
    )
}

/// The frontmost app's frontmost ordinary window, in CG global display points
/// (top-left origin, like cursor samples). Window numbers in `ignored` are
/// Misty's own companion, overlay and panel windows. None when none qualifies.
pub(crate) fn foreground_window(ignored: &[i64]) -> Option<Value> {
    let front = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
        .filter(|pid| *pid > 0)?;
    on_screen_windows().into_iter().find_map(|window| {
        if window.pid != front || window.layer != 0 || window.alpha <= 0.0 {
            return None;
        }
        if ignored.contains(&window.number) {
            return None;
        }
        let NSRect { origin, size } = window.bounds?;
        if size.width < 1.0 || size.height < 1.0 {
            return None;
        }
        Some(json!({
            "number": window.number,
            "x": origin.x, "y": origin.y,
            "width": size.width, "height": size.height,
            "app": window.owner,
            "title": window.title,
        }))
    })
}

/// One area of a display (display-local points) at its full pixel resolution,
/// fitted inside the providers' sizes like a display capture.
pub(crate) fn capture_rect(
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    pixel_scale: f64,
) -> Value {
    if !macos_at_least(14, 0) {
        return legacy();
    }
    display_still(
        display_id,
        0.8,
        StillMessages {
            disconnected: "Display disconnected. Capture the screen again.",
            timeout: "Window capture timed out. Try again.",
            no_image: "Window capture returned no image.",
            empty: "Window capture returned an empty image.",
        },
        move |_target, _filter, config| {
            let pixels = pixel_scale.max(1.0);
            let scale = capture_scale(width * pixels, height * pixels);
            // SAFETY: plain property writes before the capture starts.
            unsafe {
                config.setSourceRect(NSRect::new(
                    objc2_foundation::NSPoint::new(x, y),
                    objc2_foundation::NSSize::new(width, height),
                ));
                config.setWidth(((width * pixels * scale) as usize).max(1));
                config.setHeight(((height * pixels * scale) as usize).max(1));
            }
            Ok(Map::new())
        },
    )
}
