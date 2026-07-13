use std::{path::PathBuf, sync::Arc};

use crate::core::clipboard::ClipboardService;
use crate::core::file_sync::FileSyncPairStore;
#[cfg(desktop)]
use crate::services::extension_runtime::ExtensionRuntimeService;
#[cfg(desktop)]
use crate::services::plugin_commands::PluginCommandService;
use crate::services::{
    ai::AiService, automations::AutomationService, claude::ClaudeService, commands::CommandService,
    devices::DeviceService, directory_size::DirectorySizeService,
    environment::AppEnvironmentService, explorer::ExplorerService,
    explorer_library::ExplorerLibraryService, file_sync::FileSyncService,
    metadata::MetadataService, operation_queue::OperationQueueService,
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
    pub workspaces: WorkspaceService,
    pub operation_queue: OperationQueueService,
    pub automations: AutomationService,
    pub claude: ClaudeService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        Self::new_with_data_root(None)
    }

    pub fn new_with_data_root(data_root: Option<PathBuf>) -> Self {
        let environment = AppEnvironmentService::new_with_data_root(data_root);
        let storage_runtime = StorageRuntimeService::start(&environment);
        let clipboard = ClipboardService::new(None, None);
        clipboard.set_device_identity("local".to_owned(), "This Misty".to_owned());
        let storage = StorageService::new_with_storage_runtime(
            environment.clone(),
            Some(storage_runtime.clone()),
            None,
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
        let extension_runtime = ExtensionRuntimeService::new(environment.clone());
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
        let operation_queue = OperationQueueService::new(explorer.clone(), transfers.clone());
        let power_pack = PowerPackService::new(
            environment.clone(),
            explorer.clone(),
            operation_queue.clone(),
        );
        let ai = AiService::new();
        let automations = AutomationService::new(environment.clone(), ai.clone());
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
            workspaces,
            operation_queue,
            automations,
            claude,
        }
    }
}
