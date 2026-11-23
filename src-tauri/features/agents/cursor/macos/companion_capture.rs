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

pub(crate) fn capture_scale(width: f64, height: f64) -> f64 {
    1.0_f64.min((768.0 / width.min(height)).min(1568.0 / width.max(height)))
}

fn legacy() -> Value {
    json!({ "legacy_capture": true })
}

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

pub(crate) fn front_document() -> Option<String> {
    use super::accessibility::{trusted, Element};
    if !trusted() {
        return None;
    }
    let pid = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
        .filter(|pid| *pid > 0 && *pid != std::process::id() as i32)?;
    let app = Element::application(pid);
    app.set_timeout(0.25);
    let window = app.focused_window()?;
    window.set_timeout(0.25);
    let mut document = window.string("AXDocument");
    if document.is_empty() && chromium(pid) {
        document = chromium_page(&app, &window).unwrap_or_default();
    }
    (document.starts_with("file://") || document.starts_with("http"))
        .then(|| document.chars().take(2_000).collect())
}

fn chromium(pid: i32) -> bool {
    const BROWSERS: &[&str] = &[
        "com.google.Chrome",
        "com.google.Chrome.beta",
        "com.google.Chrome.dev",
        "com.google.Chrome.canary",
        "org.chromium.Chromium",
        "com.microsoft.edgemac",
        "com.microsoft.edgemac.Beta",
        "com.microsoft.edgemac.Dev",
        "com.brave.Browser",
        "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi",
        "com.operasoftware.Opera",
    ];
    objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .and_then(|app| app.bundleIdentifier())
        .is_some_and(|id| BROWSERS.contains(&id.to_string().as_str()))
}

fn chromium_page(
    app: &super::accessibility::Element,
    window: &super::accessibility::Element,
) -> Option<String> {
    app.set_bool("AXManualAccessibility", true);
    let page = |element: &super::accessibility::Element| {
        (element.string("AXRole") == "AXWebArea")
            .then(|| element.url("AXURL"))
            .filter(|url| !url.is_empty())
    };
    let mut at = app.focused_element();
    for _ in 0..40 {
        let Some(element) = at else { break };
        if let Some(url) = page(&element) {
            return Some(url);
        }
        if element.same(window) {
            break;
        }
        at = element.parent();
    }
    let mut queue = std::collections::VecDeque::from([(window.clone(), 0usize)]);
    let mut seen = 0usize;
    while let Some((element, depth)) = queue.pop_front() {
        seen += 1;
        if seen > 400 {
            break;
        }
        if let Some(url) = page(&element) {
            return Some(url);
        }
        if depth < 14 {
            queue.extend(
                element
                    .children()
                    .into_iter()
                    .map(|child| (child, depth + 1)),
            );
        }
    }
    None
}

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
