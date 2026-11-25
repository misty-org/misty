use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Webview};

#[cfg(target_os = "macos")]
mod macos;

#[cfg(test)]
mod tests;

const SCRIPT: &str = include_str!("page_media.js");
const MOST_TEXT: usize = 200;
const MOST_ARTWORK: usize = 2048;
const MOST_SECONDS: f64 = 1.0e7;
const ACTIONS: [&str; 5] = ["play", "pause", "previoustrack", "nexttrack", "seekto"];

static APP: OnceLock<AppHandle> = OnceLock::new();

fn views() -> &'static Mutex<HashMap<usize, String>> {
    static VIEWS: OnceLock<Mutex<HashMap<usize, String>>> = OnceLock::new();
    VIEWS.get_or_init(Mutex::default)
}

fn remember(view: usize, label: String) {
    if let Ok(mut views) = views().lock() {
        views.retain(|_, known| *known != label);
        views.insert(view, label);
    }
}

fn label_of_view(view: usize) -> Option<String> {
    views().lock().ok()?.get(&view).cloned()
}

fn reports(label: &str) -> bool {
    views()
        .lock()
        .is_ok_and(|views| views.values().any(|known| known == label))
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageMedia {
    active: bool,
    playing: bool,
    title: String,
    artist: String,
    album: String,
    artwork: String,
    duration: Option<f64>,
    position: Option<f64>,
    can_previous: bool,
    can_next: bool,
    can_seek: bool,
}

fn seconds(value: Option<f64>) -> Option<Option<f64>> {
    match value {
        None => Some(None),
        Some(seconds) if seconds.is_finite() && (0.0..=MOST_SECONDS).contains(&seconds) => {
            Some(Some(seconds))
        }
        Some(_) => None,
    }
}

fn artwork(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return Some(String::new());
    }
    if raw.len() > MOST_ARTWORK {
        return None;
    }
    let url = url::Url::parse(raw).ok()?;
    (url.scheme() == "https" && url.username().is_empty() && url.password().is_none())
        .then(|| url.to_string())
}

fn short(text: &str) -> Option<String> {
    (text.chars().count() <= MOST_TEXT).then(|| text.to_owned())
}

pub(crate) fn read(raw: &str) -> Option<PageMedia> {
    if raw.len() > 8 * 1024 {
        return None;
    }
    let media: PageMedia = serde_json::from_str(raw).ok()?;
    Some(PageMedia {
        title: short(&media.title)?,
        artist: short(&media.artist)?,
        album: short(&media.album)?,
        artwork: artwork(&media.artwork)?,
        duration: seconds(media.duration)?,
        position: seconds(media.position)?,
        ..media
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageMediaEvent {
    kind: &'static str,
    id: String,
    app_id: Option<String>,
    space_id: Option<String>,
    media: PageMedia,
}

fn page_of(label: &str) -> Option<(&'static str, &str)> {
    if let Some(id) = label.strip_prefix("misty-browser-") {
        return Some(("browser", id));
    }
    crate::apps::frames::mount_of(label).map(|mount| ("app", mount))
}

fn receive(label: &str, raw: &str) {
    let Some(app) = APP.get() else { return };
    let Some(media) = read(raw) else { return };
    let Some((kind, id)) = page_of(label) else {
        return;
    };
    let Some(window) = app
        .get_webview(label)
        .map(|webview| webview.window().label().to_owned())
    else {
        return;
    };
    let (app_id, space_id) = if kind == "app" {
        (
            crate::apps::frames::app_of(id),
            crate::apps::frames::space_of(id),
        )
    } else {
        (None, None)
    };
    tell(
        app,
        &window,
        PageMediaEvent {
            kind,
            id: id.to_owned(),
            app_id,
            space_id,
            media,
        },
    );
}

fn tell(app: &AppHandle, window: &str, event: PageMediaEvent) {
    let _ = app.emit_to(window, "misty://page-media", event);
}

pub(crate) fn forget(webview: &Webview) {
    let label = webview.label();
    let known = views().lock().is_ok_and(|mut views| {
        let before = views.len();
        views.retain(|_, page| page.as_str() != label);
        views.len() != before
    });
    let (Some(app), Some((kind, id))) = (APP.get(), page_of(label)) else {
        return;
    };
    if !known {
        return;
    }
    tell(
        app,
        webview.window().label(),
        PageMediaEvent {
            kind,
            id: id.to_owned(),
            app_id: None,
            space_id: None,
            media: PageMedia::default(),
        },
    );
}

pub(crate) fn install(webview: &Webview) -> Result<(), String> {
    let _ = APP.set(webview.app_handle().clone());
    #[cfg(target_os = "macos")]
    {
        let label = webview.label().to_owned();
        webview
            .with_webview(move |native| unsafe {
                let view: &objc2_web_kit::WKWebView = &*native.inner().cast();
                if macos::install(view, SCRIPT).is_ok() {
                    remember(native.inner() as usize, label);
                }
            })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMediaPage {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMediaActRequest {
    pub page: PageMediaPage,
    pub action: String,
    #[serde(default)]
    pub position: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMediaMuteRequest {
    pub page: PageMediaPage,
    pub muted: bool,
}

fn playing_page(app: &AppHandle, page: &PageMediaPage) -> Result<Webview, String> {
    let label = match page.kind.as_str() {
        "browser" => crate::browser::webview_label(&page.id)?,
        "app" => crate::apps::frames::label_of(&page.id)?,
        _ => return Err("That page isn't one of Misty's.".to_owned()),
    };
    if !reports(&label) {
        return Err("That page plays nothing Misty can reach.".to_owned());
    }
    app.get_webview(&label)
        .ok_or_else(|| "That page has closed.".to_owned())
}

pub(crate) fn act_script(action: &str, position: Option<f64>) -> Result<String, String> {
    if !ACTIONS.contains(&action) {
        return Err("Unknown media action.".to_owned());
    }
    let position = match seconds(position) {
        Some(Some(seconds)) => seconds.to_string(),
        Some(None) => "null".to_owned(),
        None => return Err("That position isn't valid.".to_owned()),
    };
    let action = serde_json::to_string(action).map_err(|error| error.to_string())?;
    Ok(format!(
        "window.__mistyMedia && window.__mistyMedia.act({action}, {position});"
    ))
}

#[tauri::command]
pub fn page_media_act(app: AppHandle, request: PageMediaActRequest) -> Result<(), String> {
    let script = act_script(&request.action, request.position)?;
    playing_page(&app, &request.page)?
        .eval(script)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn page_media_set_muted(app: AppHandle, request: PageMediaMuteRequest) -> Result<(), String> {
    let webview = playing_page(&app, &request.page)?;
    #[cfg(target_os = "macos")]
    {
        let muted = request.muted;
        webview
            .with_webview(move |native| unsafe {
                let view: &objc2_web_kit::WKWebView = &*native.inner().cast();
                macos::set_muted(view, muted);
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, request.muted);
        Err("Muting a page isn't available here yet.".to_owned())
    }
}
