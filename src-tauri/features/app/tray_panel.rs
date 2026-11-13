//! The panel under Misty's menu bar icon on macOS: a small window of Misty's own, built from the
//! app's components (`src/features/agents/tray/TrayPanel.tsx`), in place of a system menu. It shows
//! the chats whose agents are working or waiting on the person, Tutor, and opening or quitting
//! Misty. It opens under the icon and closes when the person clicks anywhere else.
//!
//! The main window says what to show: Tutor's state (`cursor_companion_tray`) and the busy chats
//! (`tray_agents`), built in code from the person's own runs. Nothing here leaves the device.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};

pub const LABEL: &str = "misty-tray";
const STATE_EVENT: &str = "misty://tray-panel";
/// Sent to the main window: open this chat.
const OPEN_CHAT_EVENT: &str = "misty://tray-open-chat";
/// The window is the panel plus a clear margin its shadow falls into, in points.
const WIDTH: f64 = 320.0;
const START_HEIGHT: f64 = 320.0;
const MARGIN: f64 = 16.0;
/// The panel's top sits this far under the menu bar, in points.
const GAP: f64 = 4.0;
const MOST_CHATS: usize = 6;
const MOST_TITLE: usize = 200;

/// A chat the panel lists: its agent is working, or waiting on the person.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayChat {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub agent_name: String,
    /// `working` or `needs-you`.
    pub status: String,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct TrayTutor {
    pub on: bool,
    pub ready: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct TrayPanelState {
    pub version: String,
    /// Absent until a main window says what Tutor is.
    pub tutor: Option<TrayTutor>,
    pub chats: Vec<TrayChat>,
}

#[derive(Default)]
pub struct TrayPanelStore {
    state: Mutex<TrayPanelState>,
    /// When the panel last closed because the person clicked away, in ms since the epoch. A click
    /// on the menu bar icon closes it that way first; the click then mustn't reopen it.
    closed_at: AtomicU64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn snapshot(app: &AppHandle<Wry>) -> TrayPanelState {
    let mut state = app
        .try_state::<TrayPanelStore>()
        .and_then(|store| store.state.lock().ok().map(|state| state.clone()))
        .unwrap_or_default();
    state.version = app.package_info().version.to_string();
    state
}

fn publish(app: &AppHandle<Wry>) {
    let _ = app.emit_to(LABEL, STATE_EVENT, snapshot(app));
}

fn update(app: &AppHandle<Wry>, change: impl FnOnce(&mut TrayPanelState)) {
    let Some(store) = app.try_state::<TrayPanelStore>() else {
        return;
    };
    if let Ok(mut state) = store.state.lock() {
        change(&mut state);
    }
    publish(app);
}

/// Tutor changed in the main window.
pub fn set_tutor(app: &AppHandle<Wry>, on: bool, ready: bool) {
    update(app, |state| state.tutor = Some(TrayTutor { on, ready }));
}

/// Builds the panel hidden at startup, so the first click shows it at once.
pub fn setup(app: &AppHandle<Wry>) -> Result<(), String> {
    app.manage(TrayPanelStore::default());
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("desktop.html".into()))
        .title("Misty")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .inner_size(WIDTH, START_HEIGHT)
        .build()
        .map_err(|error| format!("Could not create the menu bar panel: {error}"))?;
    let closing = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if closing.is_visible().unwrap_or(false) {
                hide(&closing);
            }
        }
    });
    Ok(())
}

fn hide(window: &WebviewWindow<Wry>) {
    if let Some(store) = window.app_handle().try_state::<TrayPanelStore>() {
        store.closed_at.store(now_ms(), Ordering::Relaxed);
    }
    let _ = window.hide();
}

/// The menu bar icon was clicked: open the panel under it, or close it.
pub fn toggle(app: &AppHandle<Wry>, icon: Rect) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide(&window);
        return;
    }
    let just_closed = app
        .try_state::<TrayPanelStore>()
        .map(|store| now_ms().saturating_sub(store.closed_at.load(Ordering::Relaxed)) < 250)
        .unwrap_or(false);
    if just_closed {
        return;
    }
    place(&window, icon);
    publish(app);
    let _ = window.show();
    let _ = window.set_focus();
}

/// Centers the panel under the icon, kept on the icon's screen.
fn place(window: &WebviewWindow<Wry>, icon: Rect) {
    let scale = window.scale_factor().unwrap_or(2.0);
    let position = icon.position.to_physical::<f64>(scale);
    let size = icon.size.to_physical::<f64>(scale);
    let width = window
        .outer_size()
        .map(|size| f64::from(size.width))
        .unwrap_or(WIDTH * scale);
    let mut x = position.x + size.width / 2.0 - width / 2.0;
    let y = position.y + size.height + (GAP - MARGIN) * scale;
    if let Ok(Some(monitor)) = window.monitor_from_point(position.x, position.y) {
        let left = f64::from(monitor.position().x);
        let right = left + f64::from(monitor.size().width);
        x = x.clamp(left, (right - width).max(left));
    }
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// What the panel shows, read once when it loads; changes arrive as events.
#[tauri::command]
pub fn tray_panel_state(
    webview: tauri::Webview,
    app: AppHandle<Wry>,
) -> Result<TrayPanelState, String> {
    if webview.label() != LABEL {
        return Err("Only the menu bar panel reads this.".into());
    }
    Ok(snapshot(&app))
}

/// The person chose something in the panel.
#[tauri::command]
pub fn tray_panel_press(
    webview: tauri::Webview,
    app: AppHandle<Wry>,
    action: String,
    chat: Option<String>,
) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("Only the menu bar panel can press here.".into());
    }
    // Tutor turns on or off in place; everything else leaves the panel.
    if action != "tutor" {
        if let Some(window) = app.get_webview_window(LABEL) {
            hide(&window);
        }
    }
    match action.as_str() {
        "open" => {
            let _ = super::tray::show_main_window(&app);
        }
        "tutor" => super::tray::tutor_toggle(&app),
        "tutor-settings" => super::tray::tutor_settings(&app),
        "chat" => {
            let id = chat.ok_or("Which chat?")?;
            let found = snapshot(&app)
                .chats
                .into_iter()
                .find(|known| known.id == id);
            let Some(found) = found else {
                return Ok(());
            };
            let _ = super::tray::show_main_window(&app);
            if let Some(label) = crate::browser::app_windows::primary_label(&app) {
                let _ = app.emit_to(label.as_str(), OPEN_CHAT_EVENT, found);
            }
        }
        "close" => {}
        "restart" => app.restart(),
        "quit" => app.exit(0),
        _ => return Err("The menu bar panel has no such action.".into()),
    }
    Ok(())
}

/// A main window lists the chats whose agents are working or waiting on the person.
#[tauri::command]
pub fn tray_agents(
    webview: tauri::Webview,
    app: AppHandle<Wry>,
    chats: Vec<TrayChat>,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can change the menu bar.".into());
    }
    let chats = chats
        .into_iter()
        .filter(|chat| chat.status == "working" || chat.status == "needs-you")
        .take(MOST_CHATS)
        .map(|mut chat| {
            chat.title = chat.title.chars().take(MOST_TITLE).collect();
            chat.agent_name = chat.agent_name.chars().take(MOST_TITLE).collect();
            chat
        })
        .collect::<Vec<_>>();
    let same = app
        .try_state::<TrayPanelStore>()
        .and_then(|store| store.state.lock().ok().map(|state| state.chats == chats))
        .unwrap_or(false);
    if !same {
        update(&app, |state| state.chats = chats);
    }
    Ok(())
}

/// The panel sizes itself to what it shows.
#[tauri::command]
pub fn tray_panel_fit(webview: tauri::Webview, height: f64) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("Only the menu bar panel sizes itself.".into());
    }
    let height = height.clamp(80.0, 640.0) + MARGIN * 2.0;
    webview
        .window()
        .set_size(tauri::LogicalSize::new(WIDTH, height))
        .map_err(|error| format!("Could not size the menu bar panel: {error}"))
}
