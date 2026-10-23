mod agents;
mod app;
mod app_setup;
#[cfg(all(desktop, debug_assertions))]
mod development_profile;
mod domain;
mod error;
mod infra;
mod platform;
mod shell_plugins;
mod telemetry;
mod voice;

pub fn run() {
    // Only development builds adjust the context.
    #[cfg_attr(not(all(desktop, debug_assertions)), allow(unused_mut))]
    let mut context = tauri::generate_context!();
    #[cfg(all(desktop, debug_assertions))]
    development_profile::configure(&mut context).expect("invalid development profile");
    // The credential store lives in the same database as every other store, so both must
    // resolve the same data root (tests and development profiles can move it).
    if let Some(home) = infra::paths::misty_home_dir() {
        let data = home.join(".local").join("data");
        // The store only adopts a folder that exists; on a fresh data root it would
        // otherwise fall back to ~/.misty and split secrets from the data they unlock.
        let _ = std::fs::create_dir_all(&data);
        let _ = misty_credential_store::configure_root(data);
    }
    // Use one TLS provider for backend calls and updates.
    let _ = rustls::crypto::ring::default_provider().install_default();
    telemetry::initialize();
    app::plugins::register(tauri::Builder::default())
        .setup(app_setup::setup)
        .invoke_handler(app::handlers::invoke_handler())
        .build(context)
        .expect("failed to build Misty Tauri app")
        .run(platform::app_lifecycle::run_event);
}
