//! What Misty does once Tauri has built the app: services, shared state, tray, menus and the
//! Space windows that were open at quit.
use crate::app::runtime::MistyRuntime;
#[cfg(desktop)]
use crate::infra::browser::agent_control::BrowserExecutionState;
#[cfg(desktop)]
use crate::infra::browser::BrowserSessionState;
#[cfg(desktop)]
use crate::infra::tray;
use crate::telemetry::TelemetryReporter;
use crate::{infra, telemetry, voice};
use tauri::Manager;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    crate::platform::plugins::mac_pip_observer::install(app.handle());
    #[cfg(target_os = "macos")]
    crate::platform::plugins::mac_traffic_lights::install();
    // Debug-only: the browser benchmark runs its tasks in Misty's own
    // tabs when asked to; see browser/eval_bridge/mod.rs.
    #[cfg(all(desktop, debug_assertions))]
    infra::browser::eval_bridge::start_if_requested(app.handle());
    // Debug-only end-to-end check of Kiri; see browser/kiri_probe.rs.
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if std::env::var_os("MISTY_KIRI_PROBE").is_some() {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let passed = infra::browser::kiri_probe::run(handle.clone()).await;
            println!(
                "KIRI PROBE DONE: {}",
                if passed { "all passed" } else { "failures" }
            );
            handle.exit(if passed { 0 } else { 1 });
        });
    }
    // Runs only in the primary instance, before any service opens a
    // file under ~/.misty. Services still create what they need, so a
    // failure here is reported rather than blocking launch.
    if let Err(error) = infra::misty_home::ensure_misty_home() {
        telemetry::PostHogTelemetryReporter
            .capture_error(&error, telemetry::SafeOperation::ApplicationStartup);
    }
    let runtime = MistyRuntime::new();
    // What this device trusts (vault root pin, device list, its own
    // policy) lives beside its other app data.
    #[cfg(desktop)]
    infra::devices::trust::set_storage_root(
        runtime
            .environment
            .store()
            .path()
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_default(),
    );
    app.manage(infra::agents::files::AgentFilesState::default());
    #[cfg(all(desktop, any(unix, windows)))]
    infra::clipboard_bridge::start(
        app.handle().clone(),
        runtime.environment.store(),
        runtime.environment.config_dir(),
    );
    app.manage(runtime);
    #[cfg(desktop)]
    app.manage(BrowserSessionState::default());
    app.manage(infra::agents::workspace::AgentWorkspaceState::default());
    #[cfg(any(target_os = "macos", windows))]
    app.manage(std::sync::Arc::new(
        infra::cursor_companion::CursorCompanionState::default(),
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
        telemetry::PostHogTelemetryReporter
            .capture_error(&error, telemetry::SafeOperation::ApplicationStartup);
        return Err(error.into());
    }
    #[cfg(target_os = "macos")]
    infra::app_menu::setup(app)?;
    #[cfg(any(target_os = "macos", windows))]
    infra::drives::start_device_change_listener(app.handle().clone());
    #[cfg(windows)]
    infra::misty_context_windows::start_foreground_watch();
    #[cfg(desktop)] // Every window belongs to a Space: reopen those open at quit.
    infra::space_windows::restore(app.handle())?;
    Ok(())
}
