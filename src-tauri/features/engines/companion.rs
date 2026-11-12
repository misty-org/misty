//! The cursor companion's turns on an outside engine. Misty's own runtime gets the screens and the
//! pointing rules in its own prompt; an engine gets the same: the display captures as images (saved
//! where engines read pasted images) and a note with the rules and the screenshots' names and sizes.
//! The engine's reply carries the same [POINT] and [GUIDE] tags, which the companion reads.
use std::path::PathBuf;

use serde_json::Value;

/// Engines take at most this many images in a turn; screens come before anything else attached.
const MOST_SCREENS: usize = 4;

/// What a companion turn adds for an engine: the screenshots to attach and the note for its prompt.
/// Nothing for a turn that isn't the companion's.
pub(super) struct CompanionTurn {
    pub images: Vec<PathBuf>,
    pub note: Option<String>,
}

pub(super) fn companion_turn(body: &Value, takes_images: bool) -> CompanionTurn {
    if body["mode"].as_str() != Some("companion") {
        return CompanionTurn { images: Vec::new(), note: None };
    }
    let mut images = Vec::new();
    let mut named = Vec::new();
    if takes_images {
        for capture in body["display_captures"].as_array().into_iter().flatten().take(MOST_SCREENS) {
            let Some(path) = save_capture(capture) else { continue };
            let screen = capture["screen"].as_str().unwrap_or("screen1").to_string();
            let size = |key: &str| capture[key].as_u64().unwrap_or(0) as u32;
            named.push((screen, size("width"), size("height")));
            images.push(path);
        }
    }
    CompanionTurn {
        images,
        note: Some(agent_runs::companion_engine_note(&named)),
    }
}

/// One capture's image, saved as a file the engine reads.
fn save_capture(capture: &Value) -> Option<PathBuf> {
    let mime = capture["mime_type"].as_str()?;
    let (head, data) = capture["data_url"].as_str()?.split_once(";base64,")?;
    if !mime.starts_with("image/") || head != format!("data:{mime}") {
        return None;
    }
    let ending = match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };
    super::images::save_pasted_image(data.to_string(), ending.to_string())
        .ok()
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_turn_that_is_not_the_companions_gets_nothing() {
        let turn = companion_turn(&json!({ "mode": "drawer" }), true);
        assert!(turn.images.is_empty() && turn.note.is_none());
    }

    #[test]
    fn an_engine_without_images_still_gets_the_rules() {
        let body = json!({
            "mode": "companion",
            "display_captures": [{ "screen": "screen1", "mime_type": "image/png",
                "data_url": "data:image/png;base64,iVBORw0KGgo=", "width": 10, "height": 10 }]
        });
        let turn = companion_turn(&body, false);
        assert!(turn.images.is_empty());
        assert!(turn.note.unwrap().contains("No screenshots came with this turn"));
    }

    #[test]
    fn a_capture_that_is_not_an_image_is_left_out() {
        let capture = json!({ "mime_type": "text/html", "data_url": "data:text/html;base64,PGI+" });
        assert!(save_capture(&capture).is_none());
    }
}
