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
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_pip_observer::install(app.handle());
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_live_resize::install();
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_traffic_lights::install();
    // Debug-only: the browser benchmark runs its tasks in Misty's own
    // tabs when asked to; see browser/eval_bridge/mod.rs.
    #[cfg(all(desktop, debug_assertions))]
    crate::browser::agent_pages::eval_bridge::start_if_requested(app.handle());
    // Debug-only end-to-end check of Kiri; see browser/kiri_probe.rs.
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if std::env::var_os("MISTY_KIRI_PROBE").is_some() {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let passed = crate::browser::kiri_link::kiri_probe::run(handle.clone()).await;
            println!(
                "KIRI PROBE DONE: {}",
                if passed { "all passed" } else { "failures" }
            );
            handle.exit(if passed { 0 } else { 1 });
        });
    }
    // Runs only in the primary instance, before any service opens a
    // file under ~/.misty. Services still create what they need, so a
    // failure here is logged rather than blocking launch.
    if let Err(error) = database::misty_home::ensure_misty_home() {
        eprintln!("Could not prepare ~/.misty: {error}");
    }
    let runtime = MistyRuntime::new();
    // What this device trusts (vault root pin, device list, its own
    // policy) lives beside its other app data.
    #[cfg(desktop)]
    crate::devices::trust::set_storage_root(
        runtime
            .environment
            .store()
            .path()
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_default(),
    );
    #[cfg(desktop)]
    database::retired_coding_data::remove_once_in_background(&runtime.environment);
    #[cfg(desktop)]
    runtime.agents.restore_folder_grants();
    app.manage(permissions::Backing(runtime.environment.store()));
    permissions::provide_import_folders(crate::browser::import::import_folders);
    app.manage(runtime);
    crate::agents::run_control::resume_at_launch(app.handle());
    #[cfg(desktop)]
    permissions::restore(app.handle());
    #[cfg(desktop)]
    app.manage(BrowserSessionState::default());
    app.manage(crate::agents::task_scopes::AgentWorkspaceState::default());
    #[cfg(any(target_os = "macos", windows))]
    app.manage(std::sync::Arc::new(
        crate::agents::cursor::CursorCompanionState::default(),
    ));
    #[cfg(any(target_os = "macos", windows))]
    app.manage(voice::DictationState::default());
    #[cfg(any(target_os = "macos", windows))]
    app.manage(voice::CaptureState::default());
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
        crate::browser::profiles::forward_changes(app.handle().clone());
        crate::browser::site_settings::permissions::follow_remote_changes(app.handle().clone());
        crate::sync::vault::follow_remote_list(app.handle().clone());
        crate::sync::vault::site_data::start(app.handle());
        // Every window belongs to a profile: reopen those open at quit.
        crate::browser::app_windows::restore(app.handle())?;
    }
    Ok(())
}
