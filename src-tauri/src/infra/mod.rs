#[cfg(desktop)]
pub mod agent_device_identity;
pub mod agents;
#[cfg(target_os = "macos")]
pub mod app_menu;
pub mod autostart;
#[cfg(desktop)]
pub mod browser;
#[cfg(desktop)]
mod browser_macos;
#[cfg(target_os = "macos")]
mod browser_pointer_guard_macos;
#[cfg(desktop)]
mod browser_scripts;
pub mod browser_shortcuts;
#[cfg(desktop)]
mod browser_theme;
pub mod claude;
pub(crate) mod cloud_handoff;
#[cfg(desktop)]
pub mod code_lsp;
#[cfg(desktop)]
pub mod code_watcher;
#[cfg(desktop)]
pub mod code_workspace;
pub mod command_defaults;
pub mod commands;
#[cfg(desktop)]
pub mod connected_devices;
pub mod credential_store;
#[cfg(desktop)]
pub mod desktop_pet;
pub mod devices;
mod direct_cloud;
pub mod directory_size;
mod directory_size_local;
pub mod document_intelligence;
pub mod environment;
pub mod explorer;
pub mod explorer_library;
#[cfg(desktop)]
pub mod extension_reporting;
#[cfg(desktop)]
pub mod extension_runtime;
#[cfg(desktop)]
pub mod extension_tools;
pub mod file_sync;
pub mod keychain;
mod macos_privacy;
pub mod mail_cache;
#[cfg(desktop)]
pub mod media_search;
pub mod metadata;
pub mod misty;
pub mod misty_template;
pub mod native_clipboard;
pub mod operation_queue;
pub mod paths;
#[cfg(desktop)]
pub mod peer_files;
#[cfg(desktop)]
pub mod peer_identity;
#[cfg(desktop)]
pub mod plugin_commands;
pub mod power_pack;
pub mod providers;
pub mod search;
pub mod self_host_entitlement;
pub mod settings;
mod settings_migration;
pub mod smart_library;
mod smart_library_ingestion;
#[cfg(desktop)]
pub mod ssh_terminal;
pub mod storage;
pub mod storage_runtime;
#[cfg(desktop)]
pub mod system_dependencies;
#[cfg(desktop)]
pub mod terminal;
pub mod transfers;
#[cfg(desktop)]
pub mod tray;
pub mod workspaces;
