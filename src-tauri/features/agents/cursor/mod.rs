//! Native cursor companion. Only the authenticated main renderer can start capture or publish state.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod host;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub use host::*;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
