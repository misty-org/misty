//! Disposable WebView2 acceptance probe. Run on Windows with an installed
//! WebView2 runtime: cargo run --example windows_cookie_probe
//! No network navigation, live provider accounts, or existing browser profiles.
// Mirrors `infra::website_data`, so the modules' `super::` paths resolve here too.
#[cfg(windows)]
#[path = "../../src/infra/website_data"]
mod website_data {
    pub(super) mod cookie_cdp;
    pub(super) mod cookie_restore;
    pub(super) use cookie_store_windows as cookie_store;
    #[allow(dead_code, reason = "the probe exercises only cookie reads and writes")]
    pub(super) mod cookie_store_windows;
    #[allow(
        dead_code,
        reason = "the cookie modules use only part of the coverage helpers"
    )]
    pub(super) mod coverage;
}
#[cfg(windows)]
#[allow(dead_code, reason = "the probe needs only the profile folder name")]
#[path = "../../src/infra/browser_profile.rs"]
mod browser_profile;
#[cfg(windows)]
#[allow(dead_code, reason = "the probe uses only CDP calls")]
#[path = "../../src/infra/webview2.rs"]
mod webview2;

// The adapter's expected-folder resolver is scoped to the supervisor's disposable
// root. The adapter itself still reads and validates actual WebView2 COM state.
#[cfg(windows)]
mod browser {
    use tauri::Manager;
    pub(super) struct ProbeRoot(pub std::path::PathBuf);
    pub(super) fn browser_data_directory(
        app: &tauri::AppHandle,
        profile: Option<&str>,
    ) -> Result<std::path::PathBuf, String> {
        let profile = profile.ok_or("missing probe profile")?;
        super::browser_profile::data_store_identifier(Some(profile))?;
        let path = app.state::<ProbeRoot>().0.join(profile);
        std::fs::create_dir_all(&path).map_err(|_| "could not create probe directory")?;
        Ok(path)
    }
}

#[cfg(windows)]
mod probe;
#[cfg(windows)]
fn main() {
    std::process::exit(probe::run());
}
#[cfg(not(windows))]
fn main() {
    eprintln!("This probe requires Windows and WebView2");
    std::process::exit(1);
}
