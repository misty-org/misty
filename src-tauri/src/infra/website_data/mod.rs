//! Website data (cookies and localStorage) read from and written to native stores. Browser
//! import uses the cookie stores; `vault::site_data` keeps both in a profile's records.

// Only the Windows cookie store uses it; elsewhere it builds for its tests.
#[cfg(any(windows, test))]
pub(super) mod cookie_cdp;
#[cfg(target_os = "macos")]
pub(crate) use cookie_store_macos as cookie_store;
#[cfg(target_os = "macos")]
pub(crate) mod cookie_store_macos;
#[cfg(windows)]
pub(crate) use cookie_store_windows as cookie_store;
#[cfg(windows)]
pub(crate) mod cookie_store_windows;
#[cfg(any(target_os = "macos", windows, test))]
pub(crate) mod coverage;
#[cfg(any(target_os = "macos", windows))]
pub(crate) mod storage;
