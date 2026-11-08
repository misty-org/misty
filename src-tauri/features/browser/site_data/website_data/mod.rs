//! Website data (cookies and localStorage) read from and written to native stores. Browser
//! import uses the cookie stores; `vault::site_data` keeps both in a profile's records.

// Only the Windows cookie store uses it; elsewhere it builds for its tests.
#[cfg(any(windows, test))]
pub(crate) mod cookie_cdp;
#[cfg(target_os = "macos")]
pub(crate) use macos::cookie_store;
#[cfg(windows)]
pub(crate) use windows::cookie_store;
#[cfg(any(target_os = "macos", windows, test))]
pub(crate) mod coverage;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(any(target_os = "macos", windows))]
pub(crate) mod storage;
#[cfg(windows)]
pub mod windows;
