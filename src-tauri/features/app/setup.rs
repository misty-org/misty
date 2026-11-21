//! What Misty does once Tauri has built the app: services, shared state, tray, menus and the
//! windows that were open at quit.
use crate::app::runtime::MistyRuntime;
#[cfg(desktop)]
use crate::app::tray;
#[cfg(desktop)]
use crate::browser::agent_pages::agent_control::BrowserExecutionState;
#[cfg(desktop)]
use crate::browser::BrowserSessionState;
use crate::voice;
use tauri::Manager;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Before anything below opens a file in Misty's own folders.
    file_access::configure(app.handle());
    // The virtual cursor an outside engine acts with (`computer_use`).
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    crate::computer_use::init(app.handle());
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_pip_observer::install(app.handle());
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_live_resize::install();
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_traffic_lights::install();
    // Misty's own page may use the microphone and camera with no WebKit panel: the system asks the
    // person once, and calls never ask again. Any other page (a website) is refused.
    #[cfg(target_os = "macos")]
    wry::set_trusted_media_origins(own_page_origins(app.handle()));
    // Debug-only: a bridge for the live acceptance specs when asked to;
    // see browser/agent_pages/eval_bridge/mod.rs.
    #[cfg(all(desktop, debug_assertions))]
    crate::browser::agent_pages::eval_bridge::start_if_requested(app.handle());
    // Runs only in the primary instance, before any service opens a
    // file under ~/.misty. Services still create what they need, so a
    // failure here is logged rather than blocking launch.
    if let Err(error) = database::misty_home::ensure_misty_home() {
        eprintln!("Could not prepare ~/.misty: {error}");
    }
    let runtime = MistyRuntime::new();
    #[cfg(desktop)]
    database::retired_coding_data::remove_once_in_background(&runtime.environment);
    // Misty holds no keys now: the ones an older Misty kept are removed once, off the main thread.
    tauri::async_runtime::spawn_blocking(crate::agents::models::forget_old_keys);
    #[cfg(desktop)]
    runtime.agents.restore_folder_grants();
    crate::engines::commands::allow_linked_folders(&runtime.environment.store());
    crate::engine_config::setup(app.handle());
    app.manage(permissions::Backing(runtime.environment.store()));
    app.manage(runtime);
    // Once: the folders Misty used to make for agents become projects or go to the Trash.
    crate::engines::chat_folder::retire_agent_folders(app.handle());
    // The pet reads its settings from the runtime's store, so it starts once that is managed.
    #[cfg(desktop)]
    crate::pets::overlay::init(app.handle());
    crate::engines::start(app);
    crate::agents::run_control::resume_at_launch(app.handle());
    #[cfg(desktop)]
    permissions::restore(app.handle());
    #[cfg(desktop)]
    crate::files::search::start_indexing(app.handle());
    #[cfg(desktop)]
    app.manage(BrowserSessionState::default());
    app.manage(crate::agents::task_scopes::AgentWorkspaceState::default());
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    app.manage(std::sync::Arc::new(
        crate::agents::cursor::CursorCompanionState::default(),
    ));
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    app.manage(voice::DictationState::default());
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    app.manage(voice::CaptureState::default());
    app.manage(voice::ShareAudioState::default());
    app.manage(voice::speech::SpeechState::default());
    #[cfg(desktop)]
    app.manage(BrowserExecutionState::default());
    // The floating Misty window is intentionally not created during
    // the first public beta. The in-app Misty panel remains available.
    #[cfg(desktop)]
    if let Err(error) = tray::setup(app) {
        let error = std::io::Error::other(error);
        eprintln!("Could not set up the tray: {error}");
        return Err(error.into());
    }
    #[cfg(target_os = "macos")]
    crate::app::app_menu::setup(app)?;
    #[cfg(windows)]
    crate::agents::screen_context::windows::start_foreground_watch();
    #[cfg(desktop)]
    {
        // Every window belongs to a profile: reopen those open at quit.
        crate::browser::app_windows::restore(app.handle())?;
    }
    Ok(())
}

/// The origins Misty's own page loads from: the bundled app's, and in a development build its
/// development server's.
#[cfg(target_os = "macos")]
fn own_page_origins(app: &tauri::AppHandle) -> Vec<String> {
    let mut origins = vec!["tauri://localhost".to_owned()];
    #[cfg(debug_assertions)]
    if let Some(url) = &app.config().build.dev_url {
        origins.push(url.origin().ascii_serialization());
    }
    #[cfg(not(debug_assertions))]
    let _ = app;
    origins
}
