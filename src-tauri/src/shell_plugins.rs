//! Keep shell plugin DOM integrations out of embedded websites and their popups.
use tauri::{
    ipc::Invoke, plugin::Plugin, webview::PageLoadPayload, AppHandle, RunEvent, Runtime, Webview,
    Window,
};
use url::Url;

/// Notification replaces `window.Notification` and Opener intercepts link clicks.
/// Tauri injects plugin scripts into every webview, even when its ACL denies the
/// plugin commands there. Run these integrations only in the shell's main frame.
/// Native setup, commands and lifecycle hooks remain owned by the original plugin.
pub(crate) struct ShellScriptPlugin<P>(pub P);

impl<R: Runtime, P: Plugin<R>> Plugin<R> for ShellScriptPlugin<P> {
    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }

    fn initialization_script(&self) -> Option<String> {
        self.0.initialization_script_2().map(|script| {
            // Tauri sets currentWebview metadata before running plugin scripts.
            // Child webviews share the "main" window, so check the webview label.
            // The explicit frame guard also covers WebView2's subframe injection.
            // This is DOM scoping; command authorization still comes from the ACL.
            format!(
                r#"(() => {{
  if (window !== window.top || window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label !== 'main') return;
  {}
}})();"#,
                script.script
            )
        })
    }

    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window);
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview);
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.0.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload);
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event);
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        self.0.extend_api(invoke)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        process::{Command, Stdio},
    };

    #[test]
    fn plugin_scripts_preserve_website_apis_and_shell_integrations() {
        let notification = ShellScriptPlugin(tauri_plugin_notification::init::<tauri::Wry>());
        let opener = ShellScriptPlugin(tauri_plugin_opener::init::<tauri::Wry>());
        assert_eq!(notification.name(), "notification");
        assert_eq!(opener.name(), "opener");
        let scripts = serde_json::json!({
            "windows": cfg!(windows),
            "notification": notification.initialization_script_2().unwrap().script,
            "opener": opener.initialization_script_2().unwrap().script,
        });
        // Execute the actual dependency scripts, so upgrades exercise the same
        // DOM and IPC behavior that will be injected by the native application.
        let mut child = Command::new("node")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../scripts/tauri-shell-plugins.test.mjs"
            ))
            .stdin(Stdio::piped())
            .spawn()
            .expect("Node is required to verify the injected plugin scripts");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(scripts.to_string().as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success());
    }
}
