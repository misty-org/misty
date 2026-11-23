#![cfg_attr(test, allow(clippy::disallowed_methods, clippy::disallowed_types))]
use file_access::fs;
pub mod account;
pub mod agent_catalog;
pub mod agents;
mod app;
pub mod apps;
pub mod bots;
#[cfg(desktop)]
pub mod browser;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub mod computer_use;
pub mod devices;
pub mod engine_config;
pub mod engines;
pub mod files;
pub mod known_names;
#[cfg(desktop)]
pub mod pets;
pub mod project;
pub mod registry;
pub mod spaces_drive;
pub mod spaces_folders;
mod voice;

pub fn run() {
    let context = tauri::generate_context!();
    file_access::conf::apply_client_defaults();
    let profile = file_access::paths::choose_profile(env!("CARGO_PKG_VERSION"));
    match database::misty_profiles::open_profile() {
        Ok(report) => {
            if let Some(source) = &report.started_from {
                eprintln!(
                    "Misty {}: started from {}",
                    profile.label(),
                    source.display()
                );
            }
            if !report.reorganized.is_empty() {
                eprintln!(
                    "Misty {}: moved {}",
                    profile.label(),
                    report.reorganized.join(", ")
                );
            }
            if !report.adopted.is_empty() {
                eprintln!(
                    "Misty {}: moved in {}",
                    profile.label(),
                    report.adopted.join(", ")
                );
            }
        }
        Err(error) => panic!("could not open Misty's {} folder: {error}", profile.label()),
    }
    if let Some(home) = file_access::paths::misty_home_dir() {
        app::crash_log::install(&home);
        misty_credential_store::move_out_of_dot_local(&home)
            .expect("could not move Misty's data out of ~/.misty/.local");
        let data = misty_credential_store::home_data_dir(&home);
        let _ = fs::create_dir_all(&data);
        let _ = misty_credential_store::configure_root(data);
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    app::plugins::register(tauri::Builder::default())
        .setup(app::setup::setup)
        .invoke_handler(app::handlers::invoke_handler())
        .build(context)
        .expect("failed to build Misty Tauri app")
        .run(app::lifecycle::run_event);
}
