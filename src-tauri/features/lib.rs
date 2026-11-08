use file_access::fs;
pub mod account;
pub mod agents;
mod app;
#[cfg(desktop)]
pub mod browser;
pub mod devices;
pub mod memory;
#[cfg(desktop)]
pub mod sync;
mod voice;

pub fn run() {
    // Only development builds adjust the context.
    #[cfg_attr(not(all(desktop, debug_assertions)), allow(unused_mut))]
    let mut context = tauri::generate_context!();
    #[cfg(all(desktop, debug_assertions))]
    database::development_profile::configure(&mut context).expect("invalid development profile");
    // The credential store lives in the same database as every other store, so both must
    // resolve the same data root (tests and development profiles can move it).
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
        // A full reload of a window closes the pages its old renderer made.
        .on_page_load(|webview, payload| {
            browser::close_pages_on_renderer_load(webview, payload);
            agents::run_control::sessions::on_renderer_load(webview, payload);
        })
        .invoke_handler(app::handlers::invoke_handler())
        .build(context)
        .expect("failed to build Misty Tauri app")
        .run(app::lifecycle::run_event);
}
