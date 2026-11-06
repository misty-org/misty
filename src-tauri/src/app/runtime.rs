use std::{path::PathBuf, sync::Arc};

use crate::domain::clipboard::ClipboardService;
#[cfg(desktop)]
use crate::domain::clipboard::{NativeClipboard, SharedClipboardClient};
#[cfg(desktop)]
use crate::infra::cloud_clipboard::CloudClipboard;
use crate::infra::{
    agents::AgentService, environment::AppEnvironmentService, settings::SettingsService, shortcuts::ShortcutService,
};

pub struct MistyRuntime {
    pub navigation_names: crate::infra::navigation_names::NavigationNamesService,
    pub environment: AppEnvironmentService,
    pub clipboard: Arc<ClipboardService>,
    pub settings: SettingsService,
    pub shortcuts: ShortcutService,
    #[cfg(desktop)]
    pub cloud_clipboard: CloudClipboard,
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
        // clipboard ring in sync. Clips from other devices never touch the system clipboard.
        #[cfg(desktop)]
        let shared_clipboard: Arc<dyn SharedClipboardClient> = Arc::new(cloud_clipboard.clone());
        #[cfg(desktop)]
        let clipboard = ClipboardService::new(Some(native_clipboard), Some(shared_clipboard));
        #[cfg(not(desktop))]
        let clipboard = ClipboardService::new(None, None);
        clipboard.set_device_identity("local".to_owned(), "This Misty".to_owned());
        #[cfg(desktop)]
        {
            let _ = clipboard.start();
        }
        let settings = SettingsService::new(environment.clone());
        let shortcuts = ShortcutService::new(environment.clone());
        let agents = AgentService::new(environment.clone());

        Self {
            navigation_names: crate::infra::navigation_names::NavigationNamesService::new(
                environment.store(),
            ),
            environment,
            clipboard,
            settings,
            shortcuts,
            #[cfg(desktop)]
            cloud_clipboard,
            agents,
        }
    }
}
