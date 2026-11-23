use super::*;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PointerMessage {
    pub(super) token: String,
    pub(super) pointer: PointerPosition,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PointerPosition {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) inside: bool,
}

pub(super) fn pointer_message(raw: &str) -> Option<PointerMessage> {
    if raw.len() > 1024 {
        return None;
    }
    let message: PointerMessage = serde_json::from_str(raw).ok()?;
    let p = &message.pointer;
    if !p.x.is_finite()
        || !p.y.is_finite()
        || !(0.0..=100_000.0).contains(&p.x)
        || !(0.0..=100_000.0).contains(&p.y)
    {
        return None;
    }
    Some(message)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NavigateMessage {
    pub(super) navigate: String,
}

pub(super) fn navigate_message(raw: &str) -> Option<Url> {
    if raw.len() > 400_000 {
        return None;
    }
    let message: NavigateMessage = serde_json::from_str(raw).ok()?;
    let url = Url::parse(&message.navigate).ok()?;
    matches!(url.scheme(), "misty-shortcut" | "misty-context-menu").then_some(url)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BackgroundMessage {
    pub(super) token: String,
    pub(super) background: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DragMessage {
    pub(super) token: String,
    pub(super) drag: bool,
}

pub(super) fn drag_message(raw: &str) -> Option<DragMessage> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ZoomMessage {
    pub(super) token: String,
    pub(super) zoom: bool,
}

pub(super) fn zoom_message(raw: &str) -> Option<ZoomMessage> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CaretMessage {
    pub(super) token: String,
    pub(super) caret: Option<CaretRect>,
}

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(deny_unknown_fields)]
pub(super) struct CaretRect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) w: f64,
    pub(super) h: f64,
}

pub(super) fn caret_message(raw: &str) -> Option<CaretMessage> {
    if raw.len() > 512 || !raw.contains("\"caret\"") {
        return None;
    }
    let message: CaretMessage = serde_json::from_str(raw).ok()?;
    let in_range = |v: f64| v.is_finite() && v.abs() <= 1_000_000.0;
    if let Some(rect) = message.caret {
        if ![rect.x, rect.y, rect.w, rect.h].into_iter().all(in_range)
            || rect.w < 0.0
            || rect.h < 0.0
        {
            return None;
        }
    }
    Some(message)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct FullscreenMessage {
    pub(super) token: String,
    pub(super) fullscreen: bool,
}

pub(super) fn fullscreen_message(raw: &str) -> Option<FullscreenMessage> {
    if raw.len() > 256 || !raw.contains("\"fullscreen\"") {
        return None;
    }
    serde_json::from_str(raw).ok()
}

pub(super) fn background_message(raw: &str) -> Option<BackgroundMessage> {
    if raw.len() > 1024 {
        return None;
    }
    let message: BackgroundMessage = serde_json::from_str(raw).ok()?;
    let color = message.background.as_bytes();
    if color.len() != 7 || color[0] != b'#' || !color[1..].iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    Some(message)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StatusMessage {
    pub(super) token: String,
    pub(super) status: StatusChange,
    #[serde(default)]
    pub(super) url: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum StatusChange {
    Stopped,
    Loaded,
    Location,
}

pub(super) fn status_message(raw: &str) -> Option<StatusMessage> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}
