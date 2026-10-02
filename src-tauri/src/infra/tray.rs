use std::{thread, time::Duration};

use tauri::{
    image::Image,
    menu::{IconMenuItem, IconMenuItemBuilder, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Runtime, Wry,
};

use crate::infra::misty;

const TRAY_SHOW_MISTY: &str = "tray_show_misty";
const TRAY_REFRESH_STATUS: &str = "tray_refresh_status";
const TRAY_STOP_SERVICES: &str = "tray_stop_services";
const TRAY_RESTART_APP: &str = "tray_restart_app";
const TRAY_QUIT_MISTY: &str = "tray_quit_misty";

pub struct MistyTrayState {
    _tray_icon: TrayIcon<Wry>,
    app_status_item: IconMenuItem<Wry>,
    stop_services_item: MenuItem<Wry>,
}

pub fn setup(app: &tauri::App<Wry>) -> Result<(), String> {
    let tray_state = build_tray(app.handle())?;
    app.manage(tray_state);
    refresh(app.handle())?;
    spawn_status_worker(app.handle().clone());
    Ok(())
}

pub fn handle_menu_event(app: &AppHandle<Wry>, id: &str) {
    match id {
        TRAY_SHOW_MISTY => {
            let _ = show_main_window(app);
        }
        TRAY_REFRESH_STATUS => {
            let _ = refresh(app);
        }
        TRAY_STOP_SERVICES => {
            let _ = misty::stop_misty();
            let _ = refresh(app);
        }
        TRAY_RESTART_APP => {
            app.restart();
        }
        TRAY_QUIT_MISTY => {
            app.exit(0);
        }
        _ => {}
    }
}

fn build_tray(app: &AppHandle<Wry>) -> Result<MistyTrayState, String> {
    let tray_icon_image = Image::from_bytes(include_bytes!("../../icons/32x32.png"))
        .map_err(|error| format!("Could not load Misty tray icon: {error}"))?;

    let app_status_item = IconMenuItemBuilder::with_id("tray_status_app", "Misty: Running")
        .enabled(false)
        .icon(status_icon(true)?)
        .build(app)
        .map_err(|error| format!("Could not create Misty tray status item: {error}"))?;
    let show_item = MenuItem::with_id(app, TRAY_SHOW_MISTY, "Show Misty", true, None::<&str>)
        .map_err(|error| format!("Could not create Show Misty menu item: {error}"))?;
    let refresh_item = MenuItem::with_id(
        app,
        TRAY_REFRESH_STATUS,
        "Refresh Status",
        true,
        None::<&str>,
    )
    .map_err(|error| format!("Could not create Refresh Status menu item: {error}"))?;
    let stop_services_item =
        MenuItem::with_id(app, TRAY_STOP_SERVICES, "Stop Services", true, None::<&str>)
            .map_err(|error| format!("Could not create Stop Services menu item: {error}"))?;
    let restart_item =
        MenuItem::with_id(app, TRAY_RESTART_APP, "Restart Misty", true, None::<&str>)
            .map_err(|error| format!("Could not create Restart Misty menu item: {error}"))?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_MISTY, "Quit Misty", true, None::<&str>)
        .map_err(|error| format!("Could not create Quit Misty menu item: {error}"))?;

    let menu = Menu::with_items(
        app,
        &[
            &app_status_item,
            &PredefinedMenuItem::separator(app)
                .map_err(|error| format!("Could not create tray separator: {error}"))?,
            &show_item,
            &refresh_item,
            &stop_services_item,
            &restart_item,
            &PredefinedMenuItem::separator(app)
                .map_err(|error| format!("Could not create tray separator: {error}"))?,
            &quit_item,
        ],
    )
    .map_err(|error| format!("Could not create Misty tray menu: {error}"))?;

    let tray_icon = TrayIconBuilder::with_id("misty")
        .icon(tray_icon_image)
        .icon_as_template(false)
        .tooltip("Misty")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)
        .map_err(|error| format!("Could not create Misty tray icon: {error}"))?;

    Ok(MistyTrayState {
        _tray_icon: tray_icon,
        app_status_item,
        stop_services_item,
    })
}

fn refresh(app: &AppHandle<Wry>) -> Result<(), String> {
    let tray = app.state::<MistyTrayState>();
    tray.app_status_item
        .set_text(format!("Misty: Running (pid {})", std::process::id()))
        .map_err(|error| format!("Could not update Misty app tray status: {error}"))?;
    tray.app_status_item
        .set_icon(Some(status_icon(true)?))
        .map_err(|error| format!("Could not update Misty app tray icon: {error}"))?;
    tray.stop_services_item
        .set_enabled(false)
        .map_err(|error| format!("Could not update Stop Services menu item: {error}"))?;

    Ok(())
}

pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Startup owns the first reveal, including native traffic-light layout.
    if !crate::platform::plugins::mac_rounded_corners::main_window_ready() {
        return Ok(());
    }
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| "Could not find the Misty window.".to_owned())?;
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

fn status_icon(running: bool) -> Result<Image<'static>, String> {
    let bytes: &[u8] = if running {
        &include_bytes!("../../icons/status-green.png")[..]
    } else {
        &include_bytes!("../../icons/status-red.png")[..]
    };
    Image::from_bytes(bytes).map_err(|error| format!("Could not load status icon: {error}"))
}

fn spawn_status_worker(app: AppHandle<Wry>) {
    thread::spawn(move || loop {
        let _ = refresh(&app);
        thread::sleep(Duration::from_secs(3));
    });
}
