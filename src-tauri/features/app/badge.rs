use std::collections::HashMap;
use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::{AppHandle, Manager, Webview, Wry};

const MOST: u32 = 100_000;

fn counts() -> std::sync::MutexGuard<'static, HashMap<String, u32>> {
    static COUNTS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    COUNTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn badge_text(count: u32) -> Option<String> {
    match count {
        0 => None,
        1..=99 => Some(count.to_string()),
        _ => Some("99+".to_string()),
    }
}

#[tauri::command]
pub fn app_set_badge(webview: Webview, app: AppHandle<Wry>, count: u32) -> Result<(), String> {
    let label = webview.label().to_string();
    if !crate::browser::app_windows::is_person_window(&label) {
        return Err("Only Misty's own windows can change the app's icon.".into());
    }
    let open = app.webviews();
    let total = {
        let mut counts = counts();
        counts.retain(|known, _| open.contains_key(known));
        if count == 0 {
            counts.remove(&label);
        } else {
            counts.insert(label, count.min(MOST));
        }
        counts.values().copied().max().unwrap_or(0)
    };
    show(&app, total);
    Ok(())
}

fn show(app: &AppHandle<Wry>, total: u32) {
    let text = badge_text(total);
    super::tray::show_count(app, text.as_deref());
    #[cfg(target_os = "macos")]
    if let Some(window) = app.webview_windows().into_values().next() {
        let _ = window.set_badge_label(text.clone());
    }
    #[cfg(target_os = "linux")]
    for window in app.webview_windows().into_values() {
        let _ = window.set_badge_count((total > 0).then_some(i64::from(total)));
    }
    #[cfg(windows)]
    {
        let overlay = text.as_deref().map(|text| {
            let mut pixels = vec![0u8; (OVERLAY * OVERLAY * 4) as usize];
            draw_bubble(&mut pixels, OVERLAY, text, OVERLAY);
            pixels
        });
        for window in app.webview_windows().into_values() {
            let icon = overlay
                .as_ref()
                .map(|pixels| tauri::image::Image::new(pixels, OVERLAY, OVERLAY));
            let _ = window.set_overlay_icon(icon);
        }
    }
}

#[cfg(windows)]
const OVERLAY: u32 = 32;

const FILL: [u8; 4] = [0xf5, 0xf5, 0xf4, 0xff];
const EDGE: [u8; 4] = [0x5f, 0x63, 0x68, 0xff];
const INK: [u8; 4] = [0x20, 0x21, 0x24, 0xff];

const GLYPHS: [(char, [u8; 5]); 11] = [
    ('0', [0b111, 0b101, 0b101, 0b101, 0b111]),
    ('1', [0b010, 0b110, 0b010, 0b010, 0b111]),
    ('2', [0b111, 0b001, 0b111, 0b100, 0b111]),
    ('3', [0b111, 0b001, 0b111, 0b001, 0b111]),
    ('4', [0b101, 0b101, 0b111, 0b001, 0b001]),
    ('5', [0b111, 0b100, 0b111, 0b001, 0b111]),
    ('6', [0b111, 0b100, 0b111, 0b101, 0b111]),
    ('7', [0b111, 0b001, 0b001, 0b001, 0b001]),
    ('8', [0b111, 0b101, 0b111, 0b101, 0b111]),
    ('9', [0b111, 0b101, 0b111, 0b001, 0b111]),
    ('+', [0b000, 0b010, 0b111, 0b010, 0b000]),
];

fn glyph(c: char) -> Option<[u8; 5]> {
    GLYPHS
        .iter()
        .find(|(known, _)| *known == c)
        .map(|(_, rows)| *rows)
}

fn put(pixels: &mut [u8], size: u32, x: i64, y: i64, color: [u8; 4]) {
    if x < 0 || y < 0 || x >= i64::from(size) || y >= i64::from(size) {
        return;
    }
    let at = ((y as u32 * size + x as u32) * 4) as usize;
    pixels[at..at + 4].copy_from_slice(&color);
}

fn in_pill(x: f64, y: f64, left: f64, top: f64, width: f64, height: f64) -> bool {
    let radius = height / 2.0;
    let middle = top + radius;
    let start = left + radius;
    let end = left + width - radius;
    let nearest = x.clamp(start, end.max(start));
    let (dx, dy) = (x - nearest, y - middle);
    dx * dx + dy * dy <= radius * radius
}

/// Draws a count bubble (its text a few digits or "99+") at the bottom right of a square RGBA
/// picture `size` wide: a light pill with a dark edge and dark digits, `height` tall.
pub(crate) fn draw_bubble(pixels: &mut [u8], size: u32, text: &str, height: u32) {
    let chars: Vec<[u8; 5]> = text.chars().filter_map(glyph).collect();
    if chars.is_empty() {
        return;
    }
    let count = chars.len() as u32;
    let scale = ((height * 6 / 10) / 5)
        .min((size.saturating_sub(4)) / (count * 4))
        .max(1);
    let gap = scale;
    let text_width = count * 3 * scale + (count - 1) * gap;
    let text_height = 5 * scale;
    let width = (text_width + height / 2).max(height).min(size);
    let left = f64::from(size - width);
    let top = f64::from(size - height);
    let (w, h) = (f64::from(width), f64::from(height));
    for y in (size - height)..size {
        for x in (size - width)..size {
            let (px, py) = (f64::from(x) + 0.5, f64::from(y) + 0.5);
            if in_pill(px, py, left + 1.0, top + 1.0, w - 2.0, h - 2.0) {
                put(pixels, size, i64::from(x), i64::from(y), FILL);
            } else if in_pill(px, py, left, top, w, h) {
                put(pixels, size, i64::from(x), i64::from(y), EDGE);
            }
        }
    }
    let start_x = i64::from(size - width) + i64::from((width - text_width) / 2);
    let start_y = i64::from(size - height) + i64::from((height - text_height) / 2);
    for (index, rows) in chars.iter().enumerate() {
        let origin = start_x + i64::from(index as u32 * (3 * scale + gap));
        for (row, bits) in rows.iter().enumerate() {
            for column in 0..3u32 {
                if bits & (0b100 >> column) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        put(
                            pixels,
                            size,
                            origin + i64::from(column * scale + dx),
                            start_y + i64::from(row as u32 * scale + dy),
                            INK,
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_read_as_numbers_up_to_99() {
        assert_eq!(badge_text(0), None);
        assert_eq!(badge_text(7).as_deref(), Some("7"));
        assert_eq!(badge_text(99).as_deref(), Some("99"));
        assert_eq!(badge_text(140).as_deref(), Some("99+"));
    }

    #[test]
    fn a_bubble_stays_inside_its_picture_and_draws_its_digits() {
        for text in ["3", "42", "99+"] {
            let mut pixels = vec![0u8; 32 * 32 * 4];
            draw_bubble(&mut pixels, 32, text, 18);
            let ink = pixels.chunks(4).filter(|pixel| *pixel == INK).count();
            let fill = pixels.chunks(4).filter(|pixel| *pixel == FILL).count();
            assert!(ink > 0 && fill > 0, "{text} drew nothing");
            assert!(pixels[..(32 * 13 * 4)].iter().all(|byte| *byte == 0));
        }
    }
}
