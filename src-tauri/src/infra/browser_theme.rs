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

// Remote sites own their colors. Transparent light pages need the browser's
// standard white canvas, regardless of Misty's toolbar theme.
pub(super) fn browser_background(_value: &str) -> Color {
    Color(255, 255, 255, 255)
}
