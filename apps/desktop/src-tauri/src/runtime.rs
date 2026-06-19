use std::sync::Arc;

use crate::core::clipboard::ClipboardService;
use crate::core::file_sync::FileSyncPairStore;
use crate::services::{
    commands::CommandService, environment::AppEnvironmentService, explorer::ExplorerService,
    file_sync::FileSyncService, operation_queue::OperationQueueService, providers::ProviderService,
    proxy::ProxyService, settings::SettingsService, transfers::TransferService,
    workspaces::WorkspaceService,
};

pub struct MistyRuntime {
    pub environment: AppEnvironmentService,
    pub clipboard: Arc<ClipboardService>,
    pub proxy: ProxyService,
    pub providers: ProviderService,
    pub transfers: TransferService,
    pub sync_pairs: FileSyncPairStore,
    pub file_sync: FileSyncService,
    pub settings: SettingsService,
    pub commands: CommandService,
    pub explorer: ExplorerService,
    pub workspaces: WorkspaceService,
    pub operation_queue: OperationQueueService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        let environment = AppEnvironmentService::new();
        let clipboard = ClipboardService::new(None, None);
        let proxy = ProxyService::new(environment.clone());
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let sync_pairs = FileSyncPairStore::new(environment.misty_db_path());
        let settings = SettingsService::new(environment.clone());
        let commands = CommandService::new(environment.clone());
        let explorer = ExplorerService::new(
            environment.clone(),
            proxy.clone(),
            providers.clone(),
            transfers.clone(),
        );
        let file_sync =
            FileSyncService::new(environment.clone(), explorer.clone(), sync_pairs.clone());
        let workspaces = WorkspaceService::new(environment.clone());
        let operation_queue = OperationQueueService::new(explorer.clone());

        Self {
            environment,
            clipboard,
            proxy,
            providers,
            transfers,
            sync_pairs,
            file_sync,
            settings,
            commands,
            explorer,
            workspaces,
            operation_queue,
        }
    }
}
