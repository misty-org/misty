//! Website data (cookies and storage) read from and restored to native stores for sync.

#[cfg(any(windows, test))]
// Only the Windows cookie store uses it; elsewhere it builds for its tests.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) mod cookie_cdp;
#[cfg(any(target_os = "macos", windows))]
pub(super) mod cookie_restore;
#[cfg(target_os = "macos")]
pub(crate) use cookie_store_macos as cookie_store;
#[cfg(target_os = "macos")]
pub(crate) mod cookie_store_macos;
#[cfg(windows)]
pub(crate) use cookie_store_windows as cookie_store;
pub(super) mod budget;
#[cfg(any(target_os = "macos", windows))]
pub(super) mod capture;
#[cfg(windows)]
pub(crate) mod cookie_store_windows;
pub(super) mod coverage;
#[cfg(any(target_os = "macos", windows))]
pub(super) mod session_storage;
#[cfg(any(target_os = "macos", windows))]
pub(super) mod signin_scope;
#[cfg(any(target_os = "macos", windows))]
pub(crate) mod storage;
#[cfg(any(target_os = "macos", windows))]
pub(super) mod storage_restore;
