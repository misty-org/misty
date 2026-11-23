use tauri::{plugin::TauriPlugin, AppHandle, Wry};

const WEBVIEW_PREFIX: &str = "misty-browser-";

struct MistyHost {
    app: AppHandle,
}

impl kiri::Host for MistyHost {
    fn run_on_main(&self, work: Box<dyn FnOnce() + Send>) {
        let _ = self.app.run_on_main_thread(work);
    }
}

pub(crate) fn plugin() -> TauriPlugin<Wry> {
    kiri::init(|app| {
        crate::browser::init_host_messages(app);
        #[cfg(target_os = "macos")]
        crate::browser::install_click_focus(app);
        #[cfg(target_os = "macos")]
        crate::browser::install_corner_scrollbars();
        kiri::Kiri::new(WEBVIEW_PREFIX, MistyHost { app: app.clone() })
    })
}
