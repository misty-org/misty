#[cfg(not(windows))]
use tauri::utils::config::Color;
use tauri::Theme;

pub(in crate::browser) fn default_browser_theme() -> String {
    "system".to_owned()
}

pub(in crate::browser) fn browser_theme(value: &str) -> Result<Option<Theme>, String> {
    match value {
        "dark" | "light" | "system" => Ok(None),
        _ => Err("Browser theme must be dark, light, or system.".to_owned()),
    }
}

// WebKit disables its own backing draw, so use the browser's default canvas
// for unpainted areas. Never inherit Misty's theme here: transparent website
// backgrounds should retain the browser's normal canvas color.
#[cfg(not(windows))]
pub(in crate::browser) fn browser_background() -> Color {
    Color(255, 255, 255, 255)
}
