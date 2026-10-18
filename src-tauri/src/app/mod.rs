//! Application entry points: Tauri command handlers and shared runtime state.

#[cfg(desktop)]
pub mod checkpoint_commands;
pub mod clipboard_commands;
pub mod commands;
#[cfg(desktop)]
pub mod device_admission_commands;
#[cfg(desktop)]
pub mod device_commands;
#[cfg(desktop)]
pub mod device_job_commands;
#[cfg(desktop)]
pub mod project_commands;
#[cfg(desktop)]
pub mod runner_commands;
pub mod runtime;
pub mod shortcut_commands;
