#[cfg(desktop)]
pub mod browser_agent_control;
#[cfg(desktop)]
pub mod agent_device_identity;
pub mod agents;
#[cfg(target_os = "macos")]
pub mod app_menu;
pub mod autostart;
#[cfg(desktop)]
pub mod browser;
#[cfg(target_os = "ios")]
#[path = "browser_ios.rs"]
pub mod browser;
#[cfg(any(desktop, target_os = "ios"))]
pub(crate) mod browser_macos;
#[cfg(target_os = "macos")]
mod browser_pointer_guard_macos;
#[cfg(any(desktop, target_os = "ios"))]
mod browser_scripts;
pub mod browser_shortcuts;
#[cfg(any(desktop, target_os = "ios"))]
mod browser_theme;
pub mod claude;
pub(crate) mod cloud_handoff;
#[cfg(all(desktop, not(target_os = "macos")))]
pub mod code_lsp;
pub mod command_defaults;
pub mod commands;
#[cfg(any(desktop, target_os = "ios"))]
pub mod connected_devices;
pub mod credential_store;
#[cfg(desktop)]
mod declarative_panel;
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
pub mod file_sync;
pub mod keychain;
mod macos_privacy;
pub mod mail_cache;
#[cfg(desktop)]
pub mod media_search;
pub mod metadata;
pub mod misty;
pub mod misty_template;
pub mod mobile_cache;
pub mod native_clipboard;
pub mod operation_queue;
pub mod paths;
#[cfg(any(desktop, target_os = "ios"))]
pub mod peer_files;
#[cfg(any(desktop, target_os = "ios"))]
pub mod peer_identity;
#[cfg(desktop)]
pub mod plugin_commands;
#[cfg(desktop)]
mod plugin_routes;
pub mod power_pack;
pub mod providers;
pub mod search;
pub mod self_host_entitlement;
pub mod settings;
mod settings_migration;
pub mod smart_library;
mod smart_library_ingestion;
#[cfg(all(desktop, not(target_os = "macos")))]
pub mod ssh_terminal;
pub mod storage;
pub mod storage_runtime;
#[cfg(desktop)]
pub mod system_dependencies;
#[cfg(all(desktop, not(target_os = "macos")))]
pub mod terminal;
pub mod transfers;
#[cfg(desktop)]
pub mod tray;
pub mod workspaces;

mod browser_profile;

pub mod browser_provider;

#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) async fn evaluate_probe_javascript(webview: tauri::Webview, script: String) -> Result<String, String> {
    browser_macos::evaluate_browser_async_javascript(webview, script).await
}

pub mod navigation_names;

#[cfg(target_os = "macos")]
pub(crate) mod native_process_worker;
#[cfg(target_os = "macos")]
pub(crate) mod peer_transport_worker;
#[cfg(target_os = "macos")]
pub(crate) mod space_peer_session;
#[cfg(target_os = "macos")]
pub(crate) mod space_peer_roots;
#[cfg(target_os = "macos")]
pub(crate) mod space_peer_files;

#[cfg(target_os = "macos")]
pub(crate) mod terminal_service;

pub mod misty_context;
