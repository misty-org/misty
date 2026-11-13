#[cfg(not(windows))]
use tauri::utils::config::Color;

// WebKit disables its own backing draw, so use the browser's default canvas
// for unpainted areas. Never inherit Misty's theme here: transparent website
// backgrounds should retain the browser's normal canvas color.
#[cfg(not(windows))]
pub(in crate::browser) fn browser_background() -> Color {
    Color(255, 255, 255, 255)
}
