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
