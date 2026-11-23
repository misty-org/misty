#[cfg(not(windows))]
use tauri::utils::config::Color;

#[cfg(not(windows))]
pub(in crate::browser) fn browser_background() -> Color {
    Color(255, 255, 255, 255)
}
