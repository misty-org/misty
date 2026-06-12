use tauri::{utils::config::Color, Theme};

pub(super) fn default_browser_theme() -> String {
    "dark".to_owned()
}

pub(super) fn browser_theme(value: &str) -> Result<Option<Theme>, String> {
    match value {
        "dark" => Ok(Some(Theme::Dark)),
        "light" => Ok(Some(Theme::Light)),
        "system" => Ok(None),
        _ => Err("Browser theme must be dark, light, or system.".to_owned()),
    }
}

pub(super) fn browser_background(value: &str) -> Color {
    match value {
        "light" => Color(255, 255, 255, 255),
        _ => Color(32, 33, 36, 255),
    }
}
