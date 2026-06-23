use std::sync::Arc;

use crate::core::clipboard::{ClipboardService, SharedClipboardClient};
use crate::core::file_sync::FileSyncPairStore;
use crate::services::{
    claude::ClaudeService, commands::CommandService, devices::DeviceService,
    environment::AppEnvironmentService, explorer::ExplorerService,
    explorer_library::ExplorerLibraryService, file_sync::FileSyncService,
    operation_queue::OperationQueueService, plugin_commands::PluginCommandService,
    providers::ProviderService, proxy::ProxyService, proxy_clipboard::ProxyClipboardClient,
    settings::SettingsService, transfers::TransferService, workspaces::WorkspaceService,
};

pub struct MistyRuntime {
    pub environment: AppEnvironmentService,
    pub clipboard: Arc<ClipboardService>,
    pub proxy_clipboard: Arc<ProxyClipboardClient>,
    pub proxy: ProxyService,
    pub providers: ProviderService,
    pub transfers: TransferService,
    pub sync_pairs: FileSyncPairStore,
    pub file_sync: FileSyncService,
    pub settings: SettingsService,
    pub commands: CommandService,
    pub devices: DeviceService,
    pub plugin_commands: PluginCommandService,
    pub explorer: ExplorerService,
    pub explorer_library: ExplorerLibraryService,
    pub workspaces: WorkspaceService,
    pub operation_queue: OperationQueueService,
    pub claude: ClaudeService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        let environment = AppEnvironmentService::new();
        let proxy_clipboard = ProxyClipboardClient::new(
            environment.proxy_url(),
            "local".to_owned(),
            "This Misty".to_owned(),
        );
        let shared_clipboard_client: Arc<dyn SharedClipboardClient> = proxy_clipboard.clone();
        let clipboard = ClipboardService::new(None, Some(shared_clipboard_client));
        clipboard.set_device_identity("local".to_owned(), "This Misty".to_owned());
        proxy_clipboard.start(clipboard.clone());
        let proxy = ProxyService::new(environment.clone());
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let sync_pairs = FileSyncPairStore::new(environment.misty_db_path());
        let settings = SettingsService::new(environment.clone());
        let commands = CommandService::new(environment.clone());
        let devices = DeviceService::new();
        let plugin_commands = PluginCommandService::new(environment.clone());
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        let explorer = ExplorerService::new(
            environment.clone(),
            proxy.clone(),
            providers.clone(),
            transfers.clone(),
            explorer_library.clone(),
        );
        let operation_queue = OperationQueueService::new(explorer.clone(), transfers.clone());
        let claude = ClaudeService::new();
        let file_sync = FileSyncService::new(
            environment.clone(),
            explorer.clone(),
            operation_queue.clone(),
            sync_pairs.clone(),
        );
        let workspaces = WorkspaceService::new(environment.clone());

        Self {
            environment,
            clipboard,
            proxy_clipboard,
            proxy,
            providers,
            transfers,
            sync_pairs,
            file_sync,
            settings,
            commands,
            devices,
            plugin_commands,
            explorer,
            explorer_library,
            workspaces,
            operation_queue,
            claude,
        }
    }
}
