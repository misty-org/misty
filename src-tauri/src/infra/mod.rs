#[cfg(desktop)]
pub mod agent_device_identity;
pub mod agent_workspace;
pub mod agents;
#[cfg(target_os = "macos")]
pub mod app_menu;
pub mod autostart;
#[cfg(desktop)]
pub mod browser;
#[cfg(desktop)]
pub mod browser_agent_control;

#[cfg(desktop)]
pub mod browser_history;
#[cfg(desktop)]
pub mod browser_library;
#[cfg(desktop)]
pub(crate) mod browser_macos;
#[cfg(target_os = "macos")]
mod browser_pointer_guard_macos;
#[cfg(desktop)]
mod browser_scripts;
pub mod browser_search_suggest;
pub mod extensions;
pub mod browser_shortcuts;
#[cfg(desktop)]
mod browser_theme;
pub mod command_defaults;
pub mod commands;
#[cfg(desktop)]
pub mod connected_devices;
pub mod credential_store;
pub mod credentials;
#[cfg(desktop)]
pub mod device_sessions;
pub mod devices;
pub mod directory_size;
mod directory_size_local;
pub mod document_intelligence;
pub mod environment;
pub mod explorer;
pub mod explorer_library;
pub mod file_sync;
mod macos_privacy;
#[cfg(desktop)]
pub mod media_search;
pub mod metadata;
pub mod misty;
pub mod misty_home;
pub mod native_clipboard;
pub mod operation_queue;
pub mod paths;
#[cfg(desktop)]
pub mod peer_files;
#[cfg(desktop)]
pub mod peer_writes;
#[cfg(desktop)]
pub mod peer_identity;
#[cfg(desktop)]
mod plugin_routes;
pub mod power_pack;
pub mod search;
pub mod settings;
mod settings_migration;
pub mod smart_library;
mod smart_library_ingestion;
#[cfg(desktop)]
pub mod system_dependencies;
pub mod transfers;
#[cfg(desktop)]
pub mod tray;
pub mod workspaces;

mod browser_profile;

#[cfg(desktop)]
pub mod page_state;

pub mod browser_provider;

pub mod navigation_names;

#[cfg(target_os = "macos")]
pub(crate) mod native_process_worker;
#[cfg(target_os = "macos")]
pub(crate) mod peer_transport_worker;
#[cfg(target_os = "macos")]
pub(crate) mod space_peer_files;
#[cfg(target_os = "macos")]
pub(crate) mod space_peer_roots;
#[cfg(target_os = "macos")]
pub(crate) mod space_peer_session;

pub mod misty_context;

pub mod auth_cookies;

pub mod auth_http;

#[cfg(windows)]
mod browser_capture_windows;

pub mod workspace_autopilot;

pub mod browser_sync;
pub mod workspace_recovery;

#[cfg(any(windows, test))]
mod browser_cookie_cdp;
#[cfg(any(target_os = "macos", windows))]
mod browser_cookie_restore;
#[cfg(target_os = "macos")]
pub(crate) mod browser_cookie_store;
#[cfg(windows)]
#[path = "browser_cookie_store_windows.rs"]
pub(crate) mod browser_cookie_store;
mod browser_data_budget;
mod browser_data_coverage;
#[cfg(any(target_os = "macos", windows))]
mod browser_session_storage;
#[cfg(any(target_os = "macos", windows))]
mod browser_signin_scope;
#[cfg(any(target_os = "macos", windows))]
mod browser_storage_restore;
#[cfg(any(target_os = "macos", windows))]
mod browser_website_capture;
#[cfg(any(target_os = "macos", windows))]
pub(crate) mod browser_website_storage;

#[cfg(desktop)]
pub mod cursor_companion;

#[cfg(target_os = "macos")]
pub mod browser_site_permissions;

pub mod settings_profile_store;

#[cfg(unix)]
pub mod agent_files;
