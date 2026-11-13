//! Misty's side of Kiri: the host that runs Kiri's work on the UI thread, and the page hooks
//! installed with it. Kiri establishes who is calling; Misty decides what to do about it.

use tauri::{plugin::TauriPlugin, AppHandle, Wry};

/// Kiri serves browser tabs only. `tauri-permissions/capabilities/kiri.json` scopes the same set.
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
        // Focus, shortcuts, pointer and status from Misty's own page scripts.
        crate::browser::init_host_messages(app);
        // Clicks on a page activate its pane natively, before the page sees them.
        #[cfg(target_os = "macos")]
        crate::browser::install_click_focus(app);
        // Web scrollbars reach into the window's rounded corners.
        #[cfg(target_os = "macos")]
        crate::browser::install_corner_scrollbars();
        kiri::Kiri::new(WEBVIEW_PREFIX, MistyHost { app: app.clone() })
    })
}
