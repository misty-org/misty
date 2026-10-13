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

// What a view shows before its page has painted. It matches Misty's own
// canvas so a new or re-shown tab blends in instead of flashing white. Once
// the page loads it reports its real color (white for a transparent page) and
// that replaces this.
pub(super) fn browser_background(value: &str) -> Color {
    match value {
        "light" => Color(255, 255, 255, 255),
        _ => Color(19, 19, 19, 255),
    }
}
