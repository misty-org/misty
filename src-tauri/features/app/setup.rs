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
    file_access::configure(app.handle());
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    crate::computer_use::init(app.handle());
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_pip_observer::install(app.handle());
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_live_resize::install();
    #[cfg(target_os = "macos")]
    crate::app::macos_window_effects::mac_traffic_lights::install();
    #[cfg(target_os = "macos")]
    {
        crate::browser::pages::macos::webkit_hooks::set_trusted_media_origins(own_page_origins(
            app.handle(),
        ));
        crate::browser::pages::macos::webkit_hooks::install();
    }
    #[cfg(all(desktop, debug_assertions))]
    crate::browser::agent_pages::eval_bridge::start_if_requested(app.handle());
    if let Err(error) = database::misty_home::ensure_misty_home() {
        eprintln!("Could not prepare ~/.misty: {error}");
    }
    let runtime = MistyRuntime::new();
    #[cfg(desktop)]
    {
        let environment = runtime.environment.clone();
        crate::app::first_draw::after_first_draw(move || {
            database::retired_coding_data::remove_once_in_background(&environment);
        });
    }
    crate::app::first_draw::after_first_draw(|| {
        tauri::async_runtime::spawn_blocking(crate::agents::models::forget_old_keys);
    });
    #[cfg(desktop)]
    runtime.agents.restore_folder_grants();
    crate::engines::commands::allow_linked_folders(&runtime.environment.store());
    crate::engine_config::setup(app.handle());
    app.manage(permissions::Backing(runtime.environment.store()));
    app.manage(runtime);
    crate::registry::start(app.handle());
    crate::engines::chat_folder::retire_agent_folders(app.handle());
    #[cfg(desktop)]
    crate::pets::overlay::init(app.handle());
    crate::engines::start(app);
    crate::agents::run_control::resume_at_launch(app.handle());
    #[cfg(desktop)]
    permissions::restore(app.handle());
    #[cfg(desktop)]
    {
        let handle = app.handle().clone();
        crate::app::first_draw::after_first_draw(move || {
            crate::files::search::start_indexing(&handle);
        });
    }
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
    voice_speech::use_helper(voice::speech::helper_command);
    app.manage(voice::speech::SpeechState::default());
    app.manage(voice::speech_models::SpeechModelsState::default());
    #[cfg(desktop)]
    app.manage(BrowserExecutionState::default());
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
        crate::browser::app_windows::restore(app.handle())?;
    }
    Ok(())
}

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
