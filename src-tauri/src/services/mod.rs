#[cfg(desktop)]
pub mod agent_device_identity;
pub mod agents;
pub mod ai;
pub mod automations;
pub mod autostart;
pub mod claude;
pub mod commands;
pub mod devices;
pub mod directory_size;
pub mod document_intelligence;
pub mod environment;
pub mod explorer;
pub mod explorer_library;
#[cfg(desktop)]
pub mod extension_runtime;
pub mod file_sync;
pub mod keychain;
#[cfg(desktop)]
pub mod media_search;
pub mod metadata;
pub mod misty;
pub mod misty_template;
pub mod native_clipboard;
pub mod operation_queue;
pub mod paths;
#[cfg(desktop)]
pub mod plugin_commands;
pub mod power_pack;
pub mod providers;
pub mod search;
pub mod settings;
pub mod smart_library;
mod smart_library_ingestion;
pub mod storage;
pub mod storage_runtime;
#[cfg(desktop)]
pub mod system_dependencies;
pub mod transfers;
#[cfg(desktop)]
pub mod tray;
pub mod workflow_files;
pub mod workspaces;
