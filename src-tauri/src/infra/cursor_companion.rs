//! Native cursor companion. Only the authenticated main renderer can start capture or publish state.
#[cfg(any(target_os = "macos", windows))]
#[path = "cursor_companion/host.rs"]
mod host;
#[cfg(any(target_os = "macos", windows))]
pub use host::*;
