//! Application entry points: Tauri command handlers and shared runtime state.

pub mod clipboard_commands;
pub mod commands;
#[cfg(desktop)]
pub mod device_admission_commands;
#[cfg(desktop)]
pub mod device_commands;
#[cfg(desktop)]
pub mod device_job_commands;
pub mod runtime;
pub mod shortcut_commands;
