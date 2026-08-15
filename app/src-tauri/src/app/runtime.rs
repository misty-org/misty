use std::{path::PathBuf, sync::Arc};

use crate::domain::clipboard::ClipboardService;
#[cfg(desktop)]
use crate::domain::clipboard::{NativeClipboard, SharedClipboardClient};
use crate::domain::file_sync::FileSyncPairStore;
#[cfg(desktop)]
use crate::infra::connected_devices::ConnectedDevicesService;
#[cfg(desktop)]
use crate::infra::extension_runtime::ExtensionRuntimeService;
#[cfg(desktop)]
use crate::infra::media_search::MediaSearchService;
#[cfg(desktop)]
use crate::infra::plugin_commands::PluginCommandService;
use crate::infra::{
    agents::AgentService, claude::ClaudeService, commands::CommandService, devices::DeviceService,
    directory_size::DirectorySizeService, environment::AppEnvironmentService,
    explorer::ExplorerService, explorer_library::ExplorerLibraryService,
    file_sync::FileSyncService, metadata::MetadataService, operation_queue::OperationQueueService,
    power_pack::PowerPackService, providers::ProviderService, search::SearchService,
    settings::SettingsService, smart_library::SmartLibraryService, storage::StorageService,
    storage_runtime::StorageRuntimeService, transfers::TransferService,
    workspaces::WorkspaceService,
};

pub struct MistyRuntime {
    pub environment: AppEnvironmentService,
    pub clipboard: Arc<ClipboardService>,
    pub storage_runtime: StorageRuntimeService,
    pub storage: StorageService,
    pub providers: ProviderService,
    pub transfers: TransferService,
    pub sync_pairs: FileSyncPairStore,
    pub file_sync: FileSyncService,
    pub settings: SettingsService,
    pub commands: CommandService,
    pub devices: DeviceService,
    #[cfg(desktop)]
    pub connected_devices: ConnectedDevicesService,
    pub directory_size: DirectorySizeService,
    pub metadata: MetadataService,
    #[cfg(desktop)]
    pub plugin_commands: PluginCommandService,
    #[cfg(desktop)]
    pub extension_runtime: ExtensionRuntimeService,
    pub power_pack: PowerPackService,
    pub search: SearchService,
    pub explorer: ExplorerService,
    pub explorer_library: ExplorerLibraryService,
    pub smart_library: SmartLibraryService,
    #[cfg(desktop)]
    pub media_search: MediaSearchService,
    pub workspaces: WorkspaceService,
    pub operation_queue: OperationQueueService,
    pub agents: AgentService,
    pub claude: ClaudeService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        Self::new_with_data_root(None)
    }

    pub fn new_with_data_root(data_root: Option<PathBuf>) -> Self {
        let environment = AppEnvironmentService::new_with_data_root(data_root);
        let storage_runtime = StorageRuntimeService::start(&environment);
        #[cfg(desktop)]
        let connected_devices = ConnectedDevicesService::new(environment.cache_dir());
        #[cfg(desktop)]
        let native_clipboard: Arc<dyn NativeClipboard> =
            crate::infra::native_clipboard::SystemClipboardAdapter::new();
        #[cfg(desktop)]
        let shared_clipboard: Arc<dyn SharedClipboardClient> = Arc::new(connected_devices.clone());
        #[cfg(desktop)]
        let clipboard = ClipboardService::new(Some(native_clipboard), Some(shared_clipboard));
        #[cfg(not(desktop))]
        let clipboard = ClipboardService::new(None, None);
        clipboard.set_device_identity("local".to_owned(), "This Misty".to_owned());
        #[cfg(desktop)]
        {
            let clipboard_for_peer = clipboard.clone();
            let _ = connected_devices.set_clipboard_handler(Arc::new(move |payload| {
                clipboard_for_peer.accept_remote_payload(payload);
                let _ = clipboard_for_peer.apply_shared_to_system_async();
            }));
            let _ = clipboard.start();
        }
        let storage = StorageService::new_with_storage_runtime(
            environment.clone(),
            Some(storage_runtime.clone()),
        );
        let providers = ProviderService::new(storage.clone());
        let transfers = TransferService::new(environment.clone());
        let sync_pairs = FileSyncPairStore::new(environment.misty_db_path());
        let settings = SettingsService::new(environment.clone());
        let commands = CommandService::new(environment.clone());
        let devices = DeviceService::new();
        let directory_size = DirectorySizeService::new(environment.clone(), storage.clone());
        let metadata = MetadataService::new();
        #[cfg(desktop)]
        let plugin_commands = PluginCommandService::new(environment.clone());
        #[cfg(desktop)]
        let extension_runtime = ExtensionRuntimeService::new_with_storage_runtime(
            environment.clone(),
            storage_runtime.clone(),
        );
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        let search = SearchService::new(environment.clone(), providers.clone(), storage.clone());
        let explorer = ExplorerService::new(
            environment.clone(),
            storage.clone(),
            providers.clone(),
            transfers.clone(),
            explorer_library.clone(),
        );
        let smart_library = SmartLibraryService::new(environment.clone(), explorer.clone());
        #[cfg(desktop)]
        let media_search = MediaSearchService::new(environment.clone());
        let operation_queue = OperationQueueService::new(explorer.clone(), transfers.clone());
        let power_pack = PowerPackService::new(
            environment.clone(),
            explorer.clone(),
            operation_queue.clone(),
        );
        let agents = AgentService::new(environment.clone());
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
            storage_runtime,
            storage,
            providers,
            transfers,
            sync_pairs,
            file_sync,
            settings,
            commands,
            devices,
            #[cfg(desktop)]
            connected_devices,
            directory_size,
            metadata,
            #[cfg(desktop)]
            plugin_commands,
            #[cfg(desktop)]
            extension_runtime,
            power_pack,
            search,
            explorer,
            explorer_library,
            smart_library,
            #[cfg(desktop)]
            media_search,
            workspaces,
            operation_queue,
            agents,
            claude,
        }
    }
}
