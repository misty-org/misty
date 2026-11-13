//! Confined processes, the counterpart of `sandbox-exec` on macOS: an AppContainer on Windows, with a
//! Job object that bounds and ends the whole process tree, and Landlock, seccomp and namespaces on
//! Linux. Empty on other systems.
#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::*;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "linux")]
pub mod linux;
