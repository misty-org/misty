//! What a browser page is playing, for the media player beside the navigator:
//! the page's own Media Session title, artist and artwork, the playing element's
//! position, and which of the page's own controls (previous, next) exist.

use super::*;

/// Runs before page scripts. Pages register their media keys with
/// `navigator.mediaSession.setActionHandler`, which offers no way to read them
/// back, so this keeps a copy that Misty's player can call.
pub(crate) const MEDIA_SESSION_PAGE_SCRIPT: &str = r#"(() => {
  const session = navigator.mediaSession;
  if (!session || window.__mistyMediaActions) return;
  const actions = new Map();
  Object.defineProperty(window, "__mistyMediaActions", { value: actions });
  const original = session.setActionHandler.bind(session);
  session.setActionHandler = (action, handler) => {
    if (typeof handler === "function") actions.set(action, handler);
    else actions.delete(action);
    return original(action, handler);
  };
})();"#;

/// Reads the page's now-playing state. Only https artwork leaves the page.
const MEDIA_INFO_SCRIPT: &str =
    r#"(() => window.__mistyMediaSnapshot ? window.__mistyMediaSnapshot() : null)()"#;

/// Runs one of the page's own controls; play and pause fall back to the
/// playing element when the page registered none.
const MEDIA_ACTION_SCRIPT: &str = r#"(() => {
  const action = __ACTION__;
  const position = __POSITION__;
  const handler = window.__mistyMediaActions && window.__mistyMediaActions.get(action);
  if (handler) {
    try { handler({ action, seekTime: position === null ? undefined : position }); return true; } catch {}
  }
  const media = [...document.querySelectorAll("video, audio")];
  if (action === "seekto" && position !== null) {
    const element =
      media.find((m) => !m.paused && !m.ended) ||
      media.find((m) => m.dataset.mistyPaused === "1") ||
      media.filter((m) => m.currentTime > 0).sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
    if (element) element.currentTime = position;
  }
  if (action === "pause") media.filter((m) => !m.paused).forEach((m) => { m.dataset.mistyPaused = "1"; m.pause(); });
  if (action === "play") {
    const paused = media.filter((m) => m.dataset.mistyPaused === "1");
    (paused.length ? paused : media.filter((m) => m.currentTime > 0).slice(0, 1)).forEach((m) => {
      delete m.dataset.mistyPaused;
      m.play().catch(() => {});
    });
  }
  return true;
})()"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaActionRequest {
    pub id: String,
    /// "play", "pause", "previoustrack", "nexttrack" or "seekto".
    pub action: String,
    /// Where "seekto" goes, in seconds.
    #[serde(default)]
    pub position: Option<f64>,
}

#[tauri::command]
pub async fn browser_webview_media_info(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let webview = running_webview(&app, &request.id)?;
    let value = eval_json(&webview, MEDIA_INFO_SCRIPT.to_owned()).await?;
    serde_json::from_str(&value).map_err(|_| "This page has no media.".to_owned())
}

#[tauri::command]
pub fn browser_webview_media_action(
    app: AppHandle,
    request: BrowserMediaActionRequest,
) -> Result<(), String> {
    if !matches!(
        request.action.as_str(),
        "play" | "pause" | "previoustrack" | "nexttrack" | "seekto"
    ) {
        return Err("Unknown media action.".into());
    }
    // The action is one of five fixed words, so quoting it as JSON is safe.
    let action = serde_json::to_string(&request.action).map_err(|error| error.to_string())?;
    // A position is a finite, non-negative number of seconds, or none.
    let position = match request.position {
        Some(seconds) if seconds.is_finite() && (0.0..=1.0e7).contains(&seconds) => {
            seconds.to_string()
        }
        Some(_) => return Err("That position is not valid.".into()),
        None => "null".to_owned(),
    };
    running_webview(&app, &request.id)?
        .eval(
            MEDIA_ACTION_SCRIPT
                .replace("__ACTION__", &action)
                .replace("__POSITION__", &position),
        )
        .map_err(|error| error.to_string())
}

/// Reads what the page is playing with its cached captions (`__mistyMediaContext` in
/// browser/scripts/mod.rs). It never fetches: captions arrive when the video starts playing.
const MEDIA_CONTEXT_SCRIPT: &str =
    r#"(() => window.__mistyMediaContext ? window.__mistyMediaContext() : null)()"#;

/// How much was said before the current moment that a question gets, in seconds.
const SAID_BEFORE_SECONDS: f64 = 90.0;
/// A little after now, for a line that started just before the person paused.
const SAID_AFTER_SECONDS: f64 = 5.0;
/// The most transcript text one question carries.
const SAID_MAX_CHARS: usize = 2_500;

#[derive(Debug, Deserialize)]
struct PageMediaContext {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    time: Option<f64>,
    duration: Option<f64>,
    #[serde(default)]
    paused: bool,
    #[serde(default, rename = "hasMedia")]
    has_media: bool,
    #[serde(default)]
    captions: Option<Vec<(f64, String)>>,
}

/// The lines said from `SAID_BEFORE_SECONDS` before `time` to just after it, newest kept
/// when they run long, each with its start time.
pub(crate) fn transcript_window(captions: &[(f64, String)], time: f64) -> Vec<(f64, String)> {
    let mut lines: Vec<(f64, String)> = captions
        .iter()
        .filter(|(start, text)| {
            start.is_finite()
                && *start >= time - SAID_BEFORE_SECONDS
                && *start <= time + SAID_AFTER_SECONDS
                && !text.trim().is_empty()
        })
        .map(|(start, text)| (*start, text.chars().take(300).collect()))
        .collect();
    let mut total = 0;
    let mut keep = lines.len();
    while keep > 0 {
        total += lines[keep - 1].1.chars().count() + 1;
        if total > SAID_MAX_CHARS {
            break;
        }
        keep -= 1;
    }
    lines.drain(..keep);
    lines
}

/// What the front page is playing, for a question at the cursor: its title, address, the
/// current time and the transcript around it. Nothing when the page plays nothing.
#[tauri::command]
pub async fn browser_webview_media_context(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let webview = running_webview(&app, &request.id)?;
    let value = eval_json(&webview, MEDIA_CONTEXT_SCRIPT.to_owned()).await?;
    let Ok(Some(page)) = serde_json::from_str::<Option<PageMediaContext>>(&value) else {
        return Ok(Value::Null);
    };
    let Some(time) = page.time.filter(|t| t.is_finite() && *t >= 0.0) else {
        return Ok(Value::Null);
    };
    if !page.has_media {
        return Ok(Value::Null);
    }
    let transcript = page
        .captions
        .as_deref()
        .map(|captions| transcript_window(captions, time))
        .unwrap_or_default();
    Ok(serde_json::json!({
        "title": page.title.chars().take(200).collect::<String>(),
        "url": page.url.chars().take(2048).collect::<String>(),
        "time": time,
        "duration": page.duration.filter(|d| d.is_finite() && *d > 0.0),
        "paused": page.paused,
        "transcript": transcript.into_iter().map(|(t, text)| serde_json::json!({"t": t, "text": text})).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod media_context_tests {
    use super::transcript_window;

    #[test]
    fn keeps_what_was_said_around_now() {
        let captions: Vec<(f64, String)> = (0..200)
            .map(|i| (i as f64 * 2.0, format!("line {i}")))
            .collect();
        let window = transcript_window(&captions, 200.0);
        assert_eq!(window.first().unwrap().0, 110.0);
        assert_eq!(window.last().unwrap().0, 204.0);
    }

    #[test]
    fn keeps_the_newest_lines_when_they_run_long() {
        let captions: Vec<(f64, String)> = (0..90).map(|i| (i as f64, "x".repeat(100))).collect();
        let window = transcript_window(&captions, 89.0);
        let chars: usize = window.iter().map(|(_, text)| text.len() + 1).sum();
        assert!(chars <= 2_500);
        assert_eq!(window.last().unwrap().0, 89.0);
        assert!(transcript_window(&captions, 1_000.0).is_empty());
    }
}
