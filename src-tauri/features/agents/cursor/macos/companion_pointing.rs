//! Precise pointing for the cursor companion. A model's point comes from a
//! downscaled screenshot. Accessibility can name the real control near it, and
//! a full-resolution crop lets the model place it again when Accessibility
//! cannot. Both read the screen only; neither presses or focuses anything.
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde_json::{json, Map, Value};

use super::{
    accessibility::{trusted, Element},
    screen_capture::{display_still, StillMessages},
    support::macos_at_least,
};

/// Roles a person points at; containers such as groups and web areas are not.
fn target_role(role: &str) -> bool {
    [
        "AXButton",
        "AXMenuItem",
        "AXMenuBarItem",
        "AXMenuButton",
        "AXPopUpButton",
        "AXCheckBox",
        "AXRadioButton",
        "AXTextField",
        "AXTextArea",
        "AXSearchField",
        "AXComboBox",
        "AXLink",
        "AXSlider",
        "AXDisclosureTriangle",
        "AXIncrementor",
        "AXColorWell",
        "AXTab",
        "AXDockItem",
        "AXCell",
        "AXRow",
        "AXImage",
        "AXStaticText",
    ]
    .contains(&role)
}

/// Words of the model's label that name the control, without the instruction.
fn words(label: &str) -> Vec<String> {
    const SKIP: [&str; 28] = [
        "click", "open", "press", "choose", "select", "tap", "the", "a", "an", "on", "to", "in",
        "go", "use", "pick", "this", "that", "here", "type", "into", "enter", "button", "menu",
        "field", "icon", "tab", "your", "of",
    ];
    label
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 1 && !SKIP.contains(word))
        .map(str::to_owned)
        .collect()
}

fn contains(frame: &NSRect, x: f64, y: f64) -> bool {
    x >= frame.origin.x
        && x < frame.origin.x + frame.size.width
        && y >= frame.origin.y
        && y < frame.origin.y + frame.size.height
}

/// Finds the control a companion point names: the actionable element at or
/// near the point, preferring one whose text matches the label. Points are
/// global display points with a top-left origin, like cursor samples.
pub(crate) fn snap_point(x: f64, y: f64, label: &str) -> Value {
    if !trusted() {
        return json!({ "error": "accessibility" });
    }
    let words = words(label);
    let system = Element::system_wide();
    let mut offsets = vec![(0.0, 0.0)];
    for radius in [14.0_f64, 32.0] {
        for step in 0..8 {
            let angle = f64::from(step) * std::f64::consts::FRAC_PI_4;
            offsets.push((angle.cos() * radius, angle.sin() * radius));
        }
    }
    let mut seen: Vec<Element> = Vec::new();
    let mut best: Option<Value> = None;
    let (mut best_match, mut best_distance) = (-1.0_f64, f64::INFINITY);
    for (dx, dy) in offsets {
        let Some(element) = system.at_position(x + dx, y + dy) else {
            continue;
        };
        let mut current = Some(element);
        for _ in 0..5 {
            let Some(node) = current.take() else { break };
            node.set_timeout(0.25);
            let role = node.string("AXRole");
            if role == "AXWindow" || role == "AXApplication" {
                break;
            }
            let frame = node.frame().filter(|frame| {
                (target_role(&role) || node.has_action("AXPress"))
                    && frame.size.width >= 4.0
                    && frame.size.height >= 4.0
                    && frame.size.width <= 480.0
                    && frame.size.height <= 240.0
            });
            if let Some(frame) = frame {
                // Neighboring samples often land on the same control; score it once.
                if seen.iter().any(|other| other.same(&node)) {
                    break;
                }
                seen.push(node.clone());
                if node.window_title() == "Misty cursor" {
                    break;
                }
                let text = [
                    node.string("AXTitle"),
                    node.string("AXDescription"),
                    node.string("AXValue"),
                    node.string("AXHelp"),
                    node.string("AXIdentifier"),
                ]
                .join(" ")
                .to_lowercase();
                let matched = words
                    .iter()
                    .filter(|word| text.contains(word.as_str()))
                    .count();
                let score = if words.is_empty() {
                    0.0
                } else {
                    matched as f64 / words.len() as f64
                };
                let mid = (
                    frame.origin.x + frame.size.width / 2.0,
                    frame.origin.y + frame.size.height / 2.0,
                );
                let distance = (mid.0 - x).hypot(mid.1 - y);
                // A named match anywhere nearby wins; otherwise only the control
                // under the point itself is trusted.
                let acceptable = score >= 0.5 || contains(&frame, x, y);
                if acceptable
                    && (score > best_match || (score == best_match && distance < best_distance))
                {
                    best_match = score;
                    best_distance = distance;
                    best = Some(json!({
                        "x": mid.0, "y": mid.1,
                        "frame": {"x": frame.origin.x, "y": frame.origin.y, "width": frame.size.width, "height": frame.size.height},
                        "role": role, "title": node.string("AXTitle"), "matched": score >= 0.5,
                    }));
                }
                break;
            }
            current = node.parent();
        }
    }
    match best {
        Some(element) => json!({ "element": element }),
        None => json!({}),
    }
}

/// Captures a region of one display at its native pixel density, as JPEG.
/// The rectangle is in that display's local points; companion overlays are
/// excluded so the crop shows only what the person sees.
pub(crate) fn capture_region(
    display_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    max_side: f64,
) -> Value {
    if !macos_at_least(14, 0) {
        return json!({ "legacy_capture": true });
    }
    display_still(
        display_id,
        0.85,
        StillMessages {
            disconnected: "Display disconnected.",
            timeout: "Screen capture timed out.",
            no_image: "Screen capture returned no image.",
            empty: "Screen capture returned an empty image.",
        },
        move |target, filter, config| {
            // SAFETY: plain property reads and writes before the capture starts.
            unsafe {
                let (display_w, display_h) = (target.width() as f64, target.height() as f64);
                let left = x.max(0.0);
                let top = y.max(0.0);
                let right = (x + width).min(display_w);
                let bottom = (y + height).min(display_h);
                let (bounds_w, bounds_h) = (right - left, bottom - top);
                if bounds_w <= 0.0 || bounds_h <= 0.0 {
                    return Err("The region is outside the display.".into());
                }
                let pixel_scale = f64::from(filter.pointPixelScale());
                let density = if pixel_scale > 0.0 { pixel_scale } else { 1.0 };
                let scale = density.min(max_side / bounds_w.max(bounds_h));
                config.setSourceRect(NSRect::new(
                    NSPoint::new(left, top),
                    NSSize::new(bounds_w, bounds_h),
                ));
                config.setWidth(((bounds_w * scale) as usize).max(1));
                config.setHeight(((bounds_h * scale) as usize).max(1));
                let mut extra = Map::new();
                extra.insert("x".into(), json!(left));
                extra.insert("y".into(), json!(top));
                extra.insert("regionWidth".into(), json!(bounds_w));
                extra.insert("regionHeight".into(), json!(bounds_h));
                Ok(extra)
            }
        },
    )
}
