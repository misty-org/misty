//! Misty's side of Kiri: turns page signals into the browser events the shell
//! already listens for. Kiri establishes who is calling; Misty decides what to
//! do about it.

use serde_json::json;
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Wry};

/// Kiri serves browser tabs only. `capabilities/kiri.json` scopes the same set.
const WEBVIEW_PREFIX: &str = "misty-browser-";

struct MistyHost {
    app: AppHandle,
}

impl kiri::Host for MistyHost {
    fn signal(&self, caller: &kiri::Caller, signal: kiri::Signal) {
        let Some(id) = caller.webview.strip_prefix(WEBVIEW_PREFIX) else {
            return;
        };
        if let kiri::Signal::MediaAudible(audible) = signal {
            let _ = self.app.emit_to(
                super::browser::browser_owner_label(&self.app, id),
                "misty://browser-media",
                json!({ "id": id, "audible": audible }),
            );
        }
    }

    fn run_on_main(&self, work: Box<dyn FnOnce() + Send>) {
        let _ = self.app.run_on_main_thread(work);
    }
}

pub(crate) fn plugin() -> TauriPlugin<Wry> {
    kiri::init(|app| {
        // Camera and microphone requests the engines raise on their own.
        super::browser_site_permissions::init(app);
        // Focus, shortcuts, pointer and status from Misty's own page scripts.
        super::browser::init_host_messages(app);
        kiri::Kiri::new(WEBVIEW_PREFIX, MistyHost { app: app.clone() })
    })
}
