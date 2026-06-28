use std::sync::Arc;

use crate::core::clipboard::{ClipboardService, SharedClipboardClient};
use crate::core::file_sync::FileSyncPairStore;
use crate::services::{
    ai::AiService,
    claude::ClaudeService, commands::CommandService, devices::DeviceService,
    directory_size::DirectorySizeService, environment::AppEnvironmentService,
    explorer::ExplorerService, explorer_library::ExplorerLibraryService,
    file_sync::FileSyncService, operation_queue::OperationQueueService,
    plugin_commands::PluginCommandService, providers::ProviderService, proxy::ProxyService,
    proxy_clipboard::ProxyClipboardClient, proxy_runtime::ProxyRuntimeService,
    search::SearchService, settings::SettingsService, transfers::TransferService,
    workspaces::WorkspaceService,
};

pub struct MistyRuntime {
    pub environment: AppEnvironmentService,
    pub clipboard: Arc<ClipboardService>,
    pub proxy_clipboard: Arc<ProxyClipboardClient>,
    pub proxy_runtime: ProxyRuntimeService,
    pub proxy: ProxyService,
    pub providers: ProviderService,
    pub transfers: TransferService,
    pub sync_pairs: FileSyncPairStore,
    pub file_sync: FileSyncService,
    pub settings: SettingsService,
    pub commands: CommandService,
    pub devices: DeviceService,
    pub directory_size: DirectorySizeService,
    pub plugin_commands: PluginCommandService,
    pub search: SearchService,
    pub explorer: ExplorerService,
    pub explorer_library: ExplorerLibraryService,
    pub workspaces: WorkspaceService,
    pub operation_queue: OperationQueueService,
    pub ai: AiService,
    pub claude: ClaudeService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        let environment = AppEnvironmentService::new();
        let proxy_runtime = ProxyRuntimeService::start(&environment);
        let proxy_clipboard = ProxyClipboardClient::new(
            None,
            Some(proxy_runtime.clone()),
            "local".to_owned(),
            "This Misty".to_owned(),
        );
        let shared_clipboard_client: Arc<dyn SharedClipboardClient> = proxy_clipboard.clone();
        let clipboard = ClipboardService::new(None, Some(shared_clipboard_client));
        clipboard.set_device_identity("local".to_owned(), "This Misty".to_owned());
        proxy_clipboard.start(clipboard.clone());
        let proxy = ProxyService::new_with_proxy_runtime(
            environment.clone(),
            Some(proxy_runtime.clone()),
            None,
        );
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let sync_pairs = FileSyncPairStore::new(environment.misty_db_path());
        let settings = SettingsService::new(environment.clone());
        let commands = CommandService::new(environment.clone());
        let devices = DeviceService::new();
        let directory_size = DirectorySizeService::new(environment.clone(), proxy.clone());
        let plugin_commands = PluginCommandService::new(environment.clone());
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        let search = SearchService::new(environment.clone(), providers.clone(), proxy.clone());
        let explorer = ExplorerService::new(
            environment.clone(),
            proxy.clone(),
            providers.clone(),
            transfers.clone(),
            explorer_library.clone(),
        );
        let operation_queue = OperationQueueService::new(explorer.clone(), transfers.clone());
        let ai = AiService::new();
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
            proxy_runtime,
            proxy,
            providers,
            transfers,
            sync_pairs,
            file_sync,
            settings,
            commands,
            devices,
            directory_size,
            plugin_commands,
            search,
            explorer,
            explorer_library,
            workspaces,
            operation_queue,
            ai,
            claude,
        }
    }
}
