//! The messages Misty's page scripts send, each parsed strictly from its JSON.
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

/// What a page is playing, pushed whenever it changes. The fields are fixed and capped, so the
/// page can say nothing else through this message.
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct MediaState {
    pub(super) title: String,
    pub(super) artist: String,
    pub(super) artwork: String,
    pub(super) duration: Option<f64>,
    pub(super) position: Option<f64>,
    pub(super) paused: bool,
    pub(super) has_media: bool,
    pub(super) can_previous: bool,
    pub(super) can_next: bool,
    pub(super) picture_in_picture: bool,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MediaMessage {
    pub(super) token: String,
    pub(super) media: MediaState,
}

pub(super) fn media_message(raw: &str) -> Option<MediaMessage> {
    if raw.len() > 4096 {
        return None;
    }
    let message: MediaMessage = serde_json::from_str(raw).ok()?;
    let m = &message.media;
    let fine =
        |value: Option<f64>| value.is_none_or(|n| n.is_finite() && (0.0..=1.0e9).contains(&n));
    (m.title.chars().count() <= 200
        && m.artist.chars().count() <= 200
        && m.artwork.len() <= 600
        && fine(m.duration)
        && fine(m.position))
    .then_some(message)
}

/// A video came back from picture in picture still playing: the floating window's back-to-tab
/// button. Misty's window comes forward even if the person is in another app.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PictureInPictureReturn {
    pub(super) token: String,
    #[serde(rename = "pipReturn")]
    pub(super) pip_return: bool,
}

pub(super) fn picture_in_picture_return(raw: &str) -> Option<PictureInPictureReturn> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

/// A host navigation (shortcut or context menu) posted instead of loaded, so
/// the page cannot observe the URL that carries the token. The forwarders it
/// is handed to check that token exactly as they do for a navigation.
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
    matches!(
        url.scheme(),
        "misty-shortcut" | "misty-context-menu" | "misty-passwords" | "misty-extension-store"
    )
    .then_some(url)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BackgroundMessage {
    pub(super) token: String,
    pub(super) background: String,
}

/// The page asks to move the window: a press-and-drag on empty space at its top edge.
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

/// The page reports a double press on its top edge, which acts as the titlebar's double-click.
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

/// Escape stopped a loading page, its document finished loading, or the page changed its URL
/// without loading (History API or hash), naming its new address.
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
