use std::{path::PathBuf, sync::Arc};

use crate::domain::clipboard::ClipboardService;
#[cfg(desktop)]
use crate::domain::clipboard::{NativeClipboard, SharedClipboardClient};
#[cfg(desktop)]
use crate::infra::cloud_clipboard::CloudClipboard;
use crate::infra::{
    agents::AgentService, commands::CommandService, devices::DeviceService,
    environment::AppEnvironmentService, explorer::ExplorerService,
    explorer_library::ExplorerLibraryService, settings::SettingsService,
};

pub struct MistyRuntime {
    pub navigation_names: crate::infra::navigation_names::NavigationNamesService,
    pub agent_chats: crate::infra::agent_chats::AgentChatsService,
    pub environment: AppEnvironmentService,
    pub clipboard: Arc<ClipboardService>,
    pub settings: SettingsService,
    pub commands: CommandService,
    pub devices: DeviceService,
    #[cfg(desktop)]
    pub cloud_clipboard: CloudClipboard,
    pub explorer: ExplorerService,
    pub agents: AgentService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        Self::new_with_data_root(None)
    }

    pub fn new_with_data_root(data_root: Option<PathBuf>) -> Self {
        let environment = AppEnvironmentService::new_with_data_root(data_root);
        #[cfg(desktop)]
        let native_clipboard: Arc<dyn NativeClipboard> =
            crate::infra::native_clipboard::SystemClipboardAdapter::new();
        #[cfg(desktop)]
        let cloud_clipboard = CloudClipboard::default();
        // Copies reach the account's other devices through the encrypted
        // clipboard ring in sync.
        #[cfg(desktop)]
        let shared_clipboard: Arc<dyn SharedClipboardClient> = Arc::new(cloud_clipboard.clone());
        #[cfg(desktop)]
        let clipboard = ClipboardService::new(Some(native_clipboard), Some(shared_clipboard));
        #[cfg(not(desktop))]
        let clipboard = ClipboardService::new(None, None);
        clipboard.set_device_identity("local".to_owned(), "This Misty".to_owned());
        #[cfg(desktop)]
        {
            let clipboard_for_peer = clipboard.clone();
            let receive: Arc<dyn Fn(_) + Send + Sync> = Arc::new(move |payload| {
                clipboard_for_peer.accept_remote_payload(payload);
                let _ = clipboard_for_peer.apply_shared_to_system_async();
            });
            cloud_clipboard.set_handler(receive);
            let _ = clipboard.start();
        }
        let settings = SettingsService::new(environment.clone());
        let commands = CommandService::new(environment.clone());
        let devices = DeviceService::new();
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        let explorer = ExplorerService::new(environment.clone(), explorer_library.clone());
        let agents = AgentService::new(environment.clone());

        Self {
            navigation_names: crate::infra::navigation_names::NavigationNamesService::new(
                environment.store(),
                environment.config_dir().join("navigation.json"),
            ),
            agent_chats: crate::infra::agent_chats::AgentChatsService::new(environment.store()),
            environment,
            clipboard,
            settings,
            commands,
            devices,
            #[cfg(desktop)]
            cloud_clipboard,
            explorer,
            agents,
        }
    }
}
