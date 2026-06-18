use crate::services::{
    commands::CommandService, environment::AppEnvironmentService, explorer::ExplorerService,
    providers::ProviderService, proxy::ProxyService, settings::SettingsService,
    transfers::TransferService,
};

pub struct MistyRuntime {
    pub environment: AppEnvironmentService,
    pub proxy: ProxyService,
    pub providers: ProviderService,
    pub transfers: TransferService,
    pub settings: SettingsService,
    pub commands: CommandService,
    pub explorer: ExplorerService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        let environment = AppEnvironmentService::new();
        let proxy = ProxyService::new(environment.clone());
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let settings = SettingsService::new(environment.clone());
        let commands = CommandService::new(environment.clone());
        let explorer = ExplorerService::new(environment.clone());

        Self {
            environment,
            proxy,
            providers,
            transfers,
            settings,
            commands,
            explorer,
        }
    }
}
