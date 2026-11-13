use std::path::PathBuf;

use crate::agents::AgentService;
use database::environment::AppEnvironmentService;
use settings::shortcuts::ShortcutService;
use settings::SettingsService;

pub struct MistyRuntime {
    pub agent_chats: crate::agents::chats::AgentChatsService,
    pub environment: AppEnvironmentService,
    pub settings: SettingsService,
    pub shortcuts: ShortcutService,
    pub agents: AgentService,
}

impl MistyRuntime {
    pub fn new() -> Self {
        Self::new_with_data_root(None)
    }

    pub fn new_with_data_root(data_root: Option<PathBuf>) -> Self {
        let environment = AppEnvironmentService::new_with_data_root(data_root);
        let settings = SettingsService::new(environment.clone());
        let shortcuts = ShortcutService::new(environment.clone());
        let agents = AgentService::new(environment.clone());

        Self {
            agent_chats: crate::agents::chats::AgentChatsService::new(environment.store()),
            environment,
            settings,
            shortcuts,
            agents,
        }
    }
}
