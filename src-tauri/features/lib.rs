use file_access::fs;
pub mod account;
pub mod agent_catalog;
pub mod agents;
mod app;
pub mod bots;
#[cfg(desktop)]
pub mod browser;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub mod computer_use;
pub mod devices;
pub mod engine_config;
pub mod engines;
pub mod known_names;
#[cfg(desktop)]
pub mod pets;
pub mod project;
#[cfg(desktop)]
pub mod sync;
mod voice;

pub fn run() {
    let context = tauri::generate_context!();
    // Which folder in ~/.misty is this build's (see file_access::paths), settled before any path is
    // read. A new version's folder starts from the last version's here, before the database opens:
    // opened first, it would start empty.
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
            if !report.adopted.is_empty() {
                eprintln!(
                    "Misty {}: moved in {}",
                    profile.label(),
                    report.adopted.join(", ")
                );
            }
        }
        // Going on would start from an empty folder and leave the person's data behind.
        Err(error) => panic!("could not open Misty's {} folder: {error}", profile.label()),
    }
    // The credential store lives in the same database as every other store, so both must
    // resolve the same data root (tests can move it).
    if let Some(home) = file_access::paths::misty_home_dir() {
        // Before anything can open the database. Going on after a failed move would start from an
        // empty store and leave the person's real one behind, so Misty stops and tries next launch.
        misty_credential_store::move_out_of_dot_local(&home)
            .expect("could not move Misty's data out of ~/.misty/.local");
        let data = misty_credential_store::home_data_dir(&home);
        // The store only adopts a folder that exists; on a fresh data root it would
        // otherwise fall back to ~/.misty and split secrets from the data they unlock.
        let _ = fs::create_dir_all(&data);
        let _ = misty_credential_store::configure_root(data);
    }
    // Use one TLS provider for backend calls and updates.
    let _ = rustls::crypto::ring::default_provider().install_default();
    app::plugins::register(tauri::Builder::default())
        .setup(app::setup::setup)
        .on_page_load(|webview, payload| {
            agents::run_control::sessions::on_renderer_load(webview, payload);
        })
        .invoke_handler(app::handlers::invoke_handler())
        .build(context)
        .expect("failed to build Misty Tauri app")
        .run(app::lifecycle::run_event);
}
