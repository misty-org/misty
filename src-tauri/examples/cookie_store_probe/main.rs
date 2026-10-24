//! Explicit macOS integration probe. Uses synthetic cookies, random named
//! stores, no renderer IPC, and no network pages or existing Misty profiles.
//! Run: cargo run --manifest-path src-tauri/Cargo.toml --example cookie_store_probe

// Mirrors `infra::website_data`, so the modules' `super::` paths resolve here too.
#[cfg(target_os = "macos")]
#[path = "../../src/infra/website_data"]
mod website_data {
    pub(super) mod cookie_restore;
    pub(super) use cookie_store_macos as cookie_store;
    pub(super) mod cookie_store_macos;
    #[allow(
        dead_code,
        reason = "the cookie modules use only part of the coverage helpers"
    )]
    pub(super) mod coverage;
}
#[cfg(target_os = "macos")]
// This macOS probe only needs WebKit identifiers; folder helpers belong to the host.
#[expect(
    dead_code,
    reason = "the probe includes only part of the host profile module"
)]
#[path = "../../src/infra/browser_profile.rs"]
mod browser_profile;

#[cfg(target_os = "macos")]
mod probe;

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(probe::run());
}
#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This probe requires macOS 14 or later");
    std::process::exit(1);
}
