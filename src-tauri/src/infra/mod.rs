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
pub mod browser_import;
#[cfg(desktop)]
pub(crate) mod browser_kiri;
#[cfg(desktop)]
pub mod browser_library;
#[cfg(desktop)]
pub(crate) mod browser_macos;
#[cfg(target_os = "macos")]
mod browser_pointer_guard_macos;
#[cfg(desktop)]
mod browser_scripts;
pub mod browser_search_suggest;
pub mod browser_shortcuts;
#[cfg(desktop)]
mod browser_theme;
pub mod command_defaults;
pub mod clipboard_bridge;
pub mod cloud_clipboard;
pub mod commands;
#[cfg(desktop)]
pub mod connected_devices;
pub mod credential_store;
pub mod credentials;
#[cfg(desktop)]
pub mod device_admission;
#[cfg(desktop)]
pub mod device_approval;
#[cfg(desktop)]
pub mod device_approval_approver;
#[cfg(desktop)]
pub mod device_channel;
#[cfg(desktop)]
pub mod device_discovery;
#[cfg(desktop)]
pub mod device_http;
#[cfg(desktop)]
pub mod device_identity;
#[cfg(desktop)]
pub mod device_records;
#[cfg(all(test, desktop))]
mod device_records_fixture;
#[cfg(all(test, desktop))]
mod device_server_e2e_tests;
#[cfg(desktop)]
pub mod device_trust;
pub mod devices;
pub mod document_intelligence;
pub mod environment;
pub mod explorer;
pub mod explorer_library;
pub mod extensions;
pub mod kura;
mod macos_privacy;
pub mod misty;
pub mod misty_home;
pub mod native_clipboard;
pub mod paths;
#[cfg(desktop)]
pub mod peer_files;
#[cfg(desktop)]
pub mod peer_identity;
#[cfg(desktop)]
pub mod peer_writes;
#[cfg(desktop)]
mod plugin_routes;
pub mod settings;
mod settings_migration;
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

#[cfg(desktop)]
pub mod browser_site_permissions;

pub mod settings_profile_store;

#[cfg(unix)]
pub mod agent_files;
