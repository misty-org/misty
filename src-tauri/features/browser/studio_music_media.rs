//! What the studio's music player is playing, for its player card, and the card's buttons. The
//! page's own media controls do the work: the hooks below remember the handlers a music site gives
//! the system's media keys (`navigator.mediaSession`) and the media element it plays, and the card
//! reads the track the site reports and presses those same handlers. Everything read back is the
//! site's word, so it is checked and trimmed here before it reaches Misty's page.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};
use url::Url;

use crate::browser::studio_music::LABEL;

/// Runs in the music page before its own scripts: keeps the media-key handlers the site sets,
/// its last position report and the element it last played, under a symbol only this code names.
pub(crate) const MEDIA_HOOKS: &str = r#"(() => {
  const key = Symbol.for("misty.music");
  const session = navigator.mediaSession;
  if (!session || window[key]) return;
  const handlers = new Map();
  let position = null;
  let element = null;
  const setHandler = session.setActionHandler.bind(session);
  session.setActionHandler = (action, handler) => {
    if (handler) handlers.set(action, handler);
    else handlers.delete(action);
    return setHandler(action, handler);
  };
  if (session.setPositionState) {
    const setPosition = session.setPositionState.bind(session);
    session.setPositionState = (state) => {
      position = state && state.duration ? { ...state, at: Date.now() } : null;
      return setPosition(state);
    };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    element = this;
    return play.apply(this, args);
  };
  Object.defineProperty(window, key, {
    value: { handlers, position: () => position, element: () => element },
  });
})();"#;

/// The page's report, as one JSON string.
const READ_MEDIA: &str = r#"
const music = window[Symbol.for("misty.music")];
const session = navigator.mediaSession;
const meta = session && session.metadata;
const media = (music && music.element()) || document.querySelector("video, audio");
const report = music && music.position();
let duration = null;
let position = null;
if (media && Number.isFinite(media.duration) && media.duration > 0) {
  duration = media.duration;
  position = media.currentTime;
} else if (report) {
  const running = session.playbackState === "playing";
  const since = running ? ((Date.now() - report.at) / 1000) * (report.playbackRate || 1) : 0;
  duration = report.duration;
  position = Math.min(report.duration, (report.position || 0) + since);
}
const artwork = meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : "";
const has = (action) => Boolean(music && music.handlers.has(action));
return JSON.stringify({
  title: (meta && meta.title) || "",
  artist: (meta && meta.artist) || "",
  artwork,
  playing: media ? !media.paused : Boolean(session && session.playbackState === "playing"),
  position,
  duration,
  canPrevious: has("previoustrack"),
  canNext: has("nexttrack"),
  canSeek: Boolean(media) || has("seekto"),
});
"#;

/// The track as the card shows it.
#[derive(Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicMedia {
    title: String,
    artist: String,
    /// An https picture of the track, or empty.
    artwork: String,
    playing: bool,
    position: Option<f64>,
    duration: Option<f64>,
    can_previous: bool,
    can_next: bool,
    can_seek: bool,
    /// Muted from the card, which mutes the whole page.
    #[serde(skip_deserializing)]
    muted: bool,
}

/// Longest title or artist the card takes.
const MAX_TEXT: usize = 300;
/// Longest picture address the card takes.
const MAX_ARTWORK: usize = 2048;
/// Lengths past a day are a live stream's, with no end to show.
const MAX_DURATION: f64 = 86_400.0;

/// Whether the card muted the page.
static MUTED: AtomicBool = AtomicBool::new(false);

/// The player closed: its next page starts unmuted.
pub(crate) fn forget() {
    MUTED.store(false, Ordering::Relaxed);
}

/// Keeps what the site said only as far as the card can trust it: plain text cut to length, a
/// picture only over https, and a position inside a finite length.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn checked(answer: &str) -> Option<MusicMedia> {
    let mut media: MusicMedia = serde_json::from_str(answer).ok()?;
    let text = |value: &str| value.chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect();
    media.title = text(&media.title);
    media.artist = text(&media.artist);
    let picture = Url::parse(&media.artwork).ok().filter(|url| {
        url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
    });
    media.artwork = match picture {
        Some(url) if url.as_str().len() <= MAX_ARTWORK => url.into(),
        _ => String::new(),
    };
    media.duration = media
        .duration
        .filter(|length| length.is_finite() && *length > 0.0 && *length < MAX_DURATION);
    media.position = match (media.position, media.duration) {
        (Some(at), Some(length)) if at.is_finite() => Some(at.clamp(0.0, length)),
        _ => None,
    };
    media.muted = MUTED.load(Ordering::Relaxed);
    Some(media)
}

fn player(app: &AppHandle) -> Option<Webview> {
    app.get_webview(LABEL)
}

/// What the open player is playing, or `None` with no player or nothing to say.
#[tauri::command]
pub async fn studio_music_media(
    caller: Webview,
    app: AppHandle,
) -> Result<Option<MusicMedia>, String> {
    crate::project::person_window(&caller)?;
    let Some(player) = player(&app) else {
        return Ok(None);
    };
    #[cfg(target_os = "macos")]
    {
        let answer = crate::browser::pages::content_world::evaluate_in_page_world(
            player,
            READ_MEDIA.to_owned(),
        )
        .await?;
        // The page's answer is a JSON string inside the JSON WebKit hands back.
        let inner: String = serde_json::from_str(&answer).unwrap_or(answer);
        Ok(checked(&inner))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (player, READ_MEDIA);
        Ok(None)
    }
}

/// A button on the card. Each goes to the site's own handler for it, as the media keys would;
/// play, pause and seeking fall back to the element when the site set none.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MusicAction {
    Play,
    Pause,
    PreviousTrack,
    NextTrack,
    SeekTo,
}

impl MusicAction {
    fn name(self) -> &'static str {
        match self {
            Self::Play => "play",
            Self::Pause => "pause",
            Self::PreviousTrack => "previoustrack",
            Self::NextTrack => "nexttrack",
            Self::SeekTo => "seekto",
        }
    }
}

/// The script for `action`; `seconds` is where a seek goes.
fn press(action: MusicAction, seconds: Option<f64>) -> Result<String, String> {
    let seconds = match action {
        MusicAction::SeekTo => seconds
            .filter(|at| at.is_finite() && *at >= 0.0 && *at < MAX_DURATION)
            .ok_or("A seek needs a place in the track.")?,
        _ => 0.0,
    };
    let action = action.name();
    Ok(format!(
        r#"(() => {{
  const action = "{action}";
  const seconds = {seconds};
  const music = window[Symbol.for("misty.music")];
  const media = (music && music.element()) || document.querySelector("video, audio");
  const handler = music && music.handlers.get(action);
  if (handler) handler(action === "seekto" ? {{ action, seekTime: seconds }} : {{ action }});
  else if (!media) return;
  else if (action === "play") media.play();
  else if (action === "pause") media.pause();
  else if (action === "seekto") media.currentTime = seconds;
}})();"#
    ))
}

#[tauri::command]
pub fn studio_music_act(
    caller: Webview,
    app: AppHandle,
    action: MusicAction,
    seconds: Option<f64>,
) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    let Some(player) = player(&app) else {
        return Ok(());
    };
    player
        .eval(press(action, seconds)?)
        .map_err(|error| error.to_string())
}

/// Mutes or unmutes the whole music page, the way Safari's tab speaker does.
#[tauri::command]
pub fn studio_music_mute(caller: Webview, app: AppHandle, muted: bool) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    let Some(player) = player(&app) else {
        return Ok(());
    };
    #[cfg(target_os = "macos")]
    player
        .with_webview(move |platform_webview| unsafe {
            let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
            if objc2::msg_send![view, respondsToSelector: objc2::sel!(_setPageMuted:)] {
                let _: () = objc2::msg_send![view, _setPageMuted: usize::from(muted)];
            }
        })
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    player
        .eval(format!(
            "document.querySelectorAll('audio, video').forEach((el) => {{ el.muted = {muted}; }});"
        ))
        .map_err(|error| error.to_string())?;
    MUTED.store(muted, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_keeps_only_what_it_can_trust() {
        let media = checked(
            r#"{"title":"Take On Me\u0007","artist":"a-ha","artwork":"javascript:alert(1)",
               "playing":true,"position":500,"duration":244,"canNext":true}"#,
        )
        .unwrap();
        assert_eq!(media.title, "Take On Me");
        assert_eq!(media.artwork, "");
        assert_eq!(media.position, Some(244.0));
        assert!(media.can_next && !media.can_previous);

        let stream = checked(r#"{"artwork":"https://i.ytimg.com/a.jpg","duration":1e12,"position":3}"#)
            .unwrap();
        assert_eq!(stream.artwork, "https://i.ytimg.com/a.jpg");
        assert_eq!((stream.duration, stream.position), (None, None));
        assert!(checked("not json").is_none());
    }

    #[test]
    fn a_press_names_only_a_known_action_and_a_real_place() {
        assert!(press(MusicAction::NextTrack, None).unwrap().contains(r#""nexttrack""#));
        assert!(press(MusicAction::SeekTo, Some(42.5)).unwrap().contains("42.5"));
        assert!(press(MusicAction::SeekTo, Some(f64::NAN)).is_err());
        assert!(press(MusicAction::SeekTo, None).is_err());
    }
}
