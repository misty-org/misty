use tauri::{utils::config::Color, Theme};

pub(super) fn default_browser_theme() -> String {
    "system".to_owned()
}

pub(super) fn browser_theme(value: &str) -> Result<Option<Theme>, String> {
    match value {
        "dark" | "light" | "system" => Ok(None),
        _ => Err("Browser theme must be dark, light, or system.".to_owned()),
    }
}

// What a view shows under a page that paints nothing of its own: white, as in every other
// browser. A page whose root has no background must keep looking like that page, never like
// Misty's canvas. Once a page loads it reports the color it really shows and that replaces
// this, so dark sites do not show white strips while a view is resized.
pub(super) fn browser_background(_value: &str) -> Color {
    Color(255, 255, 255, 255)
}
