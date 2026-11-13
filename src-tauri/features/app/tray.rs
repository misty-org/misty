//! Misty in the menu bar. On macOS the icon is the Misty mark as a template image, and a click
//! opens Misty's own panel under it (`tray_panel`). Windows and Linux keep a system menu: the
//! notification area shows the app on left click and the menu on right click, and Linux trays
//! only open menus.

use tauri::{tray::TrayIcon, AppHandle, Emitter, Manager, Runtime, Wry};

#[cfg(not(target_os = "macos"))]
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

#[cfg(not(target_os = "macos"))]
const TRAY_SHOW_MISTY: &str = "tray_show_misty";
#[cfg(not(target_os = "macos"))]
const TRAY_RESTART_APP: &str = "tray_restart_app";
#[cfg(not(target_os = "macos"))]
const TRAY_QUIT_MISTY: &str = "tray_quit_misty";
#[cfg(not(target_os = "macos"))]
const TRAY_TUTOR: &str = "tray_tutor";
#[cfg(not(target_os = "macos"))]
const TRAY_TUTOR_SETTINGS: &str = "tray_tutor_settings";

/// Sent to the main window, whose renderer runs Tutor: turn it on or off, or open its settings.
const TUTOR_TOGGLE_EVENT: &str = "misty://tray-tutor-toggle";
const TUTOR_SETTINGS_EVENT: &str = "misty://tray-tutor-settings";

pub struct MistyTrayState {
    _tray_icon: TrayIcon<Wry>,
    /// Tutor in the system menu, checked while it's on. The main window's renderer says what it
    /// is (`cursor_companion_tray`), so the menu shows what Settings shows.
    #[cfg(not(target_os = "macos"))]
    tutor_item: CheckMenuItem<Wry>,
}

pub fn setup(app: &tauri::App<Wry>) -> Result<(), String> {
    let tray_state = build_tray(app.handle())?;
    app.manage(tray_state);
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_tray(app: &AppHandle<Wry>) -> Result<MistyTrayState, String> {
    use tauri::tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent};

    super::tray_panel::setup(app)?;
    let tray_icon = TrayIconBuilder::with_id("misty")
        .icon(super::tray_mark::image())
        .icon_as_template(true)
        .tooltip("Misty")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                rect,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                super::tray_panel::toggle(tray.app_handle(), rect);
            }
        })
        .build(app)
        .map_err(|error| format!("Could not create Misty tray icon: {error}"))?;
    Ok(MistyTrayState {
        _tray_icon: tray_icon,
    })
}

#[cfg(not(target_os = "macos"))]
fn build_tray(app: &AppHandle<Wry>) -> Result<MistyTrayState, String> {
    let item_error = |error: tauri::Error| format!("Could not create the tray menu: {error}");
    let tray_icon_image = Image::from_bytes(include_bytes!("../../icons/32x32.png"))
        .map_err(|error| format!("Could not load Misty tray icon: {error}"))?;
    // Unchecked until the main window says Tutor is on.
    let tutor_item = CheckMenuItem::with_id(app, TRAY_TUTOR, "Tutor", true, false, None::<&str>)
        .map_err(item_error)?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, TRAY_SHOW_MISTY, "Open Misty", true, None::<&str>)
                .map_err(item_error)?,
            &PredefinedMenuItem::separator(app).map_err(item_error)?,
            &tutor_item,
            &MenuItem::with_id(
                app,
                TRAY_TUTOR_SETTINGS,
                "Tutor settings",
                true,
                None::<&str>,
            )
            .map_err(item_error)?,
            &PredefinedMenuItem::separator(app).map_err(item_error)?,
            &MenuItem::with_id(app, TRAY_RESTART_APP, "Restart Misty", true, None::<&str>)
                .map_err(item_error)?,
            &MenuItem::with_id(app, TRAY_QUIT_MISTY, "Quit Misty", true, None::<&str>)
                .map_err(item_error)?,
        ],
    )
    .map_err(item_error)?;

    let tray_icon = TrayIconBuilder::with_id("misty")
        .icon(tray_icon_image)
        .tooltip("Misty")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(not(windows)))
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
        .build(app)
        .map_err(|error| format!("Could not create Misty tray icon: {error}"))?;

    Ok(MistyTrayState {
        _tray_icon: tray_icon,
        tutor_item,
    })
}

pub fn handle_menu_event(app: &AppHandle<Wry>, id: &str) {
    #[cfg(not(target_os = "macos"))]
    match id {
        TRAY_SHOW_MISTY => {
            let _ = show_main_window(app);
        }
        TRAY_RESTART_APP => app.restart(),
        TRAY_QUIT_MISTY => app.exit(0),
        TRAY_TUTOR => tutor_toggle(app),
        TRAY_TUTOR_SETTINGS => tutor_settings(app),
        _ => {}
    }
    #[cfg(target_os = "macos")]
    let _ = (app, id);
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
    #[cfg(target_os = "macos")]
    super::tray_panel::set_tutor(&app, on, ready);
    #[cfg(not(target_os = "macos"))]
    {
        let Some(tray) = app.try_state::<MistyTrayState>() else {
            return Ok(());
        };
        tray.tutor_item
            .set_text(if ready { "Tutor" } else { "Set up Tutor…" })
            .map_err(|error| format!("Could not update the Tutor menu item: {error}"))?;
        tray.tutor_item
            .set_checked(on && ready)
            .map_err(|error| format!("Could not update the Tutor menu item: {error}"))?;
    }
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
