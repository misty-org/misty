//! The operating system Misty runs on, for the app's own pages: `window.__MISTY_PLATFORM__`, set
//! before any page script runs so it can be read synchronously. It replaces tauri-plugin-os, which
//! did the same with a crate, a build script and three permissions. Websites open in agent views
//! (the labels `navigation_guard` treats as websites) and subframes don't get it.
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    }
}

/// The script that publishes the platform, its architecture and its version.
pub(crate) fn script() -> String {
    let info = serde_json::json!({
        "platform": platform(),
        "arch": std::env::consts::ARCH,
        "version": sysinfo::System::os_version().unwrap_or_default(),
    });
    format!(
        r#"(() => {{
  const label = window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? '';
  if (window !== window.top || label.startsWith('misty-browser-') || label === 'render-control') return;
  Object.defineProperty(window, '__MISTY_PLATFORM__', {{ value: Object.freeze({info}) }});
}})();"#
    )
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("misty-platform")
        .js_init_script(script())
        .build()
}

#[cfg(test)]
mod tests {
    #[test]
    fn publishes_the_platform() {
        let script = super::script();
        assert!(script.contains(&format!("\"platform\":\"{}\"", super::platform())));
        assert!(script.contains(&format!("\"arch\":\"{}\"", std::env::consts::ARCH)));
    }
}
