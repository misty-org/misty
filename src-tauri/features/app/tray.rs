//! Misty in the menu bar: the system's own menu, on every platform. On macOS the icon is the Misty
//! mark as a template image and a click opens the menu under it, like any menu bar app. Windows
//! shows the app on a left click and the menu on a right click; Linux trays only open menus.
//!
//! The menu starts a new chat, lists the chats whose agents are working or waiting on the person
//! (and stops them all), stops computer use while an agent works the screen, and holds Tutor, the
//! pet, updates, Settings and opening, restarting or quitting Misty. The main window says what to
//! list: Tutor's state (`cursor_companion_tray`), the busy chats (`tray_agents`) and a found update
//! (`tray_update`), built in code from the person's own runs; computer use is read where it runs.
//! The menu is built again whenever any of it changes. Nothing here leaves the device.

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, Runtime, Wry,
};

const TRAY_ID: &str = "misty";
const OPEN: &str = "tray_open";
const RESTART: &str = "tray_restart";
const QUIT: &str = "tray_quit";
const TUTOR: &str = "tray_tutor";
const TUTOR_SETTINGS: &str = "tray_tutor_settings";
const PET: &str = "tray_pet";
const PET_SETTINGS: &str = "tray_pet_settings";
const NEW_CHAT: &str = "tray_new_chat";
const STOP_AGENTS: &str = "tray_stop_agents";
const STOP_SCREEN: &str = "tray_stop_screen";
const UPDATES: &str = "tray_updates";
const SETTINGS: &str = "tray_settings";
/// A chat's item: this prefix and the chat's id.
const CHAT_PREFIX: &str = "tray_chat:";

/// Sent to the main window, whose renderer runs Tutor: turn it on or off, or open its settings.
const TUTOR_TOGGLE_EVENT: &str = "misty://tray-tutor-toggle";
const TUTOR_SETTINGS_EVENT: &str = "misty://tray-tutor-settings";
/// Sent to the main window: open the pet's settings, to import or pick one.
const PET_SETTINGS_EVENT: &str = "misty://tray-pet-settings";
/// Sent to the main window: open this chat.
const OPEN_CHAT_EVENT: &str = "misty://tray-open-chat";
/// Sent to the main window: start a new chat with the agent used last.
const NEW_CHAT_EVENT: &str = "misty://tray-new-chat";
/// Sent to the main window, which knows the runs: stop every chat's run.
const STOP_AGENTS_EVENT: &str = "misty://tray-stop-agents";
/// Sent to the main window: open Settings at Updates and check there, where installing lives.
const CHECK_UPDATES_EVENT: &str = "misty://tray-check-updates";
/// The app menu's own route for a shortcut command (`app_menu.rs`), here with "Open settings".
const SHORTCUT_EVENT: &str = "misty://shortcut-command";
const OPEN_SETTINGS_COMMAND: &str = "app.open_settings";

const MOST_CHATS: usize = 6;
const MOST_TITLE: usize = 200;

/// A chat the menu lists: its agent is working, or waiting on the person.
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

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct TrayTutor {
    on: bool,
    ready: bool,
}

#[derive(Default)]
struct TrayMenuState {
    /// Absent until a main window says what Tutor is.
    tutor: Option<TrayTutor>,
    chats: Vec<TrayChat>,
    /// The version a main window found to update to, if any.
    update: Option<String>,
}

/// The app, for what changes away from any handle (computer use ending), to build the menu again.
static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();

#[path = "tray_glyphs.rs"]
mod glyphs;
use glyphs::{set_glyphs, Glyph};

/// The menu and, item by item in the same order (separators included), the glyph each shows.
struct BuiltMenu {
    menu: Menu<Wry>,
    glyphs: Vec<Option<Glyph>>,
}

pub struct MistyTrayState {
    _tray_icon: TrayIcon<Wry>,
    menu: Mutex<TrayMenuState>,
}

pub fn setup(app: &tauri::App<Wry>) -> Result<(), String> {
    let handle = app.handle();
    let built = build_menu(handle, &TrayMenuState::default())?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Misty")
        .menu(&built.menu)
        .show_menu_on_left_click(cfg!(not(windows)));
    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(super::tray_mark::image())
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.icon(
        tauri::image::Image::from_bytes(include_bytes!("../../icons/32x32.png"))
            .map_err(|error| format!("Could not load Misty tray icon: {error}"))?,
    );
    let tray_icon = builder
        .on_tray_icon_event(|tray, event| {
            #[cfg(windows)]
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
            #[cfg(not(windows))]
            let _ = (tray, event);
        })
        .build(handle)
        .map_err(|error| format!("Could not create Misty tray icon: {error}"))?;
    app.manage(MistyTrayState {
        _tray_icon: tray_icon,
        menu: Mutex::new(TrayMenuState::default()),
    });
    let _ = APP.set(handle.clone());
    set_glyphs(handle, built.glyphs);
    Ok(())
}

/// The menu as the state says, in the system's own look: plain items, separators, checkmarks
/// and, on macOS, a small glyph before each item, like the system's own menu bar apps.
fn build_menu(app: &AppHandle<Wry>, state: &TrayMenuState) -> Result<BuiltMenu, String> {
    let error = |error: tauri::Error| format!("Could not build the menu bar menu: {error}");
    let menu = Menu::new(app).map_err(error)?;
    let mut glyphs: Vec<Option<Glyph>> = Vec::new();
    let mut add = |item: &dyn IsMenuItem<Wry>, glyph: Option<Glyph>| -> Result<(), String> {
        menu.append(item).map_err(error)?;
        glyphs.push(glyph);
        Ok(())
    };
    let item = |id: &str, text: &str, enabled: bool, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, text, enabled, accelerator).map_err(error)
    };
    let check = |id: &str, text: &str, checked: bool| {
        CheckMenuItem::with_id(app, id, text, true, checked, None::<&str>).map_err(error)
    };
    let separator = || PredefinedMenuItem::separator(app).map_err(error);

    let version = format!("Misty {}", app.package_info().version);
    add(&item("tray_version", &version, false, None)?, None)?;
    add(&separator()?, None)?;
    add(
        &item(NEW_CHAT, "New Chat", true, None)?,
        Some(Glyph::Symbol("square.and.pencil")),
    )?;
    add(&separator()?, None)?;

    add(&item("tray_agents", "Agents", false, None)?, None)?;
    if state.chats.is_empty() {
        add(
            &item("tray_no_agents", "None at work right now", false, None)?,
            None,
        )?;
    }
    for chat in &state.chats {
        let title = if chat.title.trim().is_empty() {
            "New chat"
        } else {
            chat.title.trim()
        };
        let waiting = chat.status == "needs-you";
        let text = format!(
            "{title} — {}{}",
            chat.agent_name,
            if waiting { " · Needs you" } else { "" }
        );
        // The chat's state as the system's own status dot: green while its agent works, amber
        // while it waits on the person.
        let dot = if waiting {
            "NSStatusPartiallyAvailable"
        } else {
            "NSStatusAvailable"
        };
        add(
            &item(&format!("{CHAT_PREFIX}{}", chat.id), &text, true, None)?,
            Some(Glyph::Named(dot)),
        )?;
    }
    if !state.chats.is_empty() {
        add(
            &item(STOP_AGENTS, "Stop All Agents", true, None)?,
            Some(Glyph::Symbol("stop.circle")),
        )?;
    }
    // While an agent works the screen, the way to take it back is always one click away, as
    // Escape is.
    if crate::computer_use::screen_in_use() {
        add(
            &item(STOP_SCREEN, "Computer use is on — Stop", true, None)?,
            Some(Glyph::Symbol("hand.raised")),
        )?;
    }

    add(&separator()?, None)?;
    let tutor_glyph = Some(Glyph::Symbol("cursorarrow.rays"));
    if let Some(tutor) = state.tutor {
        if tutor.ready {
            add(&check(TUTOR, "Tutor", tutor.on)?, tutor_glyph)?;
            add(
                &item(TUTOR_SETTINGS, "Tutor settings", true, None)?,
                Some(Glyph::Symbol("slider.horizontal.3")),
            )?;
        } else {
            add(
                &item(TUTOR_SETTINGS, "Set up Tutor", true, None)?,
                tutor_glyph,
            )?;
        }
    }
    // The pet shows as a switch once one is imported; until then the item leads to its settings,
    // where one is imported or picked.
    let pet = crate::pets::read_settings(app);
    let pet_glyph = Some(Glyph::Symbol("pawprint"));
    if pet.pet_id.trim().is_empty() {
        add(&item(PET_SETTINGS, "Set up Pet", true, None)?, pet_glyph)?;
    } else {
        add(&check(PET, "Show Pet", pet.enabled)?, pet_glyph)?;
    }

    add(&separator()?, None)?;
    let updates = match &state.update {
        Some(version) => format!("Update to Misty {version}"),
        None => "Check for Updates".to_string(),
    };
    add(
        &item(UPDATES, &updates, true, None)?,
        Some(Glyph::Symbol("arrow.down.circle")),
    )?;
    add(
        &item(SETTINGS, "Settings", true, Some("CmdOrCtrl+,"))?,
        Some(Glyph::Symbol("gearshape")),
    )?;
    add(
        &item(OPEN, "Open Misty", true, None)?,
        Some(Glyph::Symbol("macwindow")),
    )?;
    add(
        &item(RESTART, "Restart Misty", true, None)?,
        Some(Glyph::Symbol("arrow.clockwise")),
    )?;
    add(
        &item(QUIT, "Quit Misty", true, Some("CmdOrCtrl+Q"))?,
        Some(Glyph::Symbol("power")),
    )?;
    Ok(BuiltMenu { menu, glyphs })
}

/// Builds the menu again from what the menu bar knows now.
pub(crate) fn refresh(app: &AppHandle<Wry>) {
    let Some(tray_state) = app.try_state::<MistyTrayState>() else {
        return;
    };
    let Ok(state) = tray_state.menu.lock() else {
        return;
    };
    let Ok(built) = build_menu(app, &state) else {
        return;
    };
    drop(state);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(built.menu));
    }
    set_glyphs(app, built.glyphs);
}

/// Builds the menu again from anywhere, once the menu bar is set up.
pub(crate) fn changed() {
    if let Some(app) = APP.get() {
        refresh(app);
    }
}

fn update(app: &AppHandle<Wry>, change: impl FnOnce(&mut TrayMenuState) -> bool) {
    let Some(tray_state) = app.try_state::<MistyTrayState>() else {
        return;
    };
    let changed = match tray_state.menu.lock() {
        Ok(mut state) => change(&mut state),
        Err(_) => false,
    };
    if changed {
        refresh(app);
    }
}

pub fn handle_menu_event(app: &AppHandle<Wry>, id: &str) {
    if let Some(chat) = id.strip_prefix(CHAT_PREFIX) {
        open_chat(app, chat);
        return;
    }
    match id {
        OPEN => {
            let _ = show_main_window(app);
        }
        RESTART => app.restart(),
        QUIT => app.exit(0),
        TUTOR => tutor_toggle(app),
        TUTOR_SETTINGS => tutor_settings(app),
        PET_SETTINGS => to_main_window(app, PET_SETTINGS_EVENT, ()),
        NEW_CHAT => to_main_window(app, NEW_CHAT_EVENT, ()),
        STOP_AGENTS => to_main_window(app, STOP_AGENTS_EVENT, ()),
        STOP_SCREEN => crate::computer_use::computer_use_stop(app.clone()),
        UPDATES => to_main_window(app, CHECK_UPDATES_EVENT, ()),
        SETTINGS => to_main_window(app, SHORTCUT_EVENT, OPEN_SETTINGS_COMMAND),
        PET => {
            let visible = !crate::pets::read_settings(app).enabled;
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::pets::overlay::pet_set_visible(app.clone(), visible).await;
                refresh(&app);
            });
        }
        _ => {}
    }
}

/// Opens a chat the menu listed in the main window.
fn open_chat(app: &AppHandle<Wry>, id: &str) {
    let found = app.try_state::<MistyTrayState>().and_then(|tray_state| {
        tray_state
            .menu
            .lock()
            .ok()
            .and_then(|state| state.chats.iter().find(|chat| chat.id == id).cloned())
    });
    let Some(found) = found else {
        return;
    };
    let _ = show_main_window(app);
    if let Some(label) = crate::browser::app_windows::primary_label(app) {
        let _ = app.emit_to(label.as_str(), OPEN_CHAT_EVENT, found);
    }
}

/// Brings the main window forward, opening one when none is, and tells it what was chosen.
fn to_main_window(app: &AppHandle<Wry>, event: &str, payload: impl Serialize + Clone) {
    let _ = show_main_window(app);
    if let Some(label) = crate::browser::app_windows::primary_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}

/// Turns Tutor on or off, or opens its setup when it isn't set up.
pub(crate) fn tutor_toggle(app: &AppHandle<Wry>) {
    tutor_to_main_window(app, TUTOR_TOGGLE_EVENT);
}

pub(crate) fn tutor_settings(app: &AppHandle<Wry>) {
    let _ = show_main_window(app);
    tutor_to_main_window(app, TUTOR_SETTINGS_EVENT);
}

/// Tells the main window, which runs Tutor, what the person chose in the menu bar. With no window
/// open, Misty opens one first: Tutor runs only while a main window does.
fn tutor_to_main_window(app: &AppHandle<Wry>, event: &str) {
    let label = crate::browser::app_windows::primary_label(app);
    match label {
        Some(label) => {
            let _ = app.emit_to(label.as_str(), event, ());
        }
        None => {
            let _ = show_main_window(app);
        }
    }
}

/// The main window tells the menu bar what Tutor is: on or off, and whether it's set up. Not set
/// up, the item says so, and choosing it opens setup.
#[tauri::command]
pub fn cursor_companion_tray(
    webview: tauri::Webview,
    app: AppHandle<Wry>,
    on: bool,
    ready: bool,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can change the menu bar.".into());
    }
    let tutor = Some(TrayTutor { on, ready });
    update(&app, |state| {
        let changed = state.tutor != tutor;
        state.tutor = tutor;
        changed
    });
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
    update(&app, |state| {
        let changed = state.chats != chats;
        state.chats = chats;
        changed
    });
    Ok(())
}

/// A main window found a newer Misty (`version`), or none (empty): the menu offers it.
#[tauri::command]
pub fn tray_update(
    webview: tauri::Webview,
    app: AppHandle<Wry>,
    version: String,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can change the menu bar.".into());
    }
    let version = version.trim().chars().take(40).collect::<String>();
    let found = (!version.is_empty()).then_some(version);
    update(&app, |state| {
        let changed = state.update != found;
        state.update = found;
        changed
    });
    Ok(())
}

pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Startup owns the first reveal, including native traffic-light layout.
    if !crate::app::macos_window_effects::mac_rounded_corners::main_window_ready() {
        return Ok(());
    }
    let Some(window) = crate::browser::app_windows::primary(app) else {
        // Every window was closed: reopen the windows that were open, or the first profile's.
        return crate::browser::app_windows::restore(app);
    };
    window
        .show()
        .map_err(|error| format!("Could not show Misty: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("Could not unminimize Misty: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus Misty: {error}"))?;
    Ok(())
}
