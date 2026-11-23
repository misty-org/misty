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

pub(crate) fn script() -> String {
    let info = serde_json::json!({
        "platform": platform(),
        "arch": std::env::consts::ARCH,
        "version": sysinfo::System::os_version().unwrap_or_default(),
    });
    format!(
        r#"(() => {{
  const label = window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? '';
  if (window !== window.top || label.startsWith('misty-browser-') || label.startsWith('misty-app-') || label === 'render-control') return;
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
