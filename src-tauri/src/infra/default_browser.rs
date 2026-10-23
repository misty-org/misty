use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBrowserSnapshot {
    pub supported: bool,
    pub is_default: bool,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn misty_default_browser_is_current() -> bool;
    fn misty_default_browser_request();
}

pub fn snapshot() -> DefaultBrowserSnapshot {
    #[cfg(target_os = "macos")]
    {
        DefaultBrowserSnapshot {
            supported: true,
            is_default: unsafe { misty_default_browser_is_current() },
        }
    }
    #[cfg(windows)]
    {
        DefaultBrowserSnapshot {
            supported: true,
            is_default: windows::is_current(),
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        DefaultBrowserSnapshot {
            supported: false,
            is_default: false,
        }
    }
}

/// Asks the OS to make Misty the default browser. Both macOS and Windows
/// confirm with the person, so the returned snapshot may not reflect the
/// answer yet.
pub fn request() -> DefaultBrowserSnapshot {
    #[cfg(target_os = "macos")]
    unsafe {
        misty_default_browser_request();
    }
    #[cfg(windows)]
    windows::request();
    snapshot()
}

/// Web addresses Misty was started with, until the main window takes them.
static LAUNCH_URLS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Keeps the web addresses of this launch's arguments for the main window.
pub fn remember_launch<S: AsRef<str>>(args: impl IntoIterator<Item = S>) {
    if let Ok(mut urls) = LAUNCH_URLS.lock() {
        *urls = web_urls(args);
    }
}

/// The links this Space window opens: the ones Misty was started with that belong to
/// its Space, and those other apps sent it since. A link goes to the Space that claims
/// its site ("Open these sites in this Space"), else to the window used last.
#[tauri::command]
pub fn app_take_launch_urls(webview: tauri::Webview) -> Vec<String> {
    use crate::infra::space_windows;
    if !space_windows::is_app_window(webview.label()) {
        return Vec::new();
    }
    let launch = LAUNCH_URLS
        .lock()
        .map(|mut urls| std::mem::take(&mut *urls))
        .unwrap_or_default();
    let mut urls = space_windows::route_links(webview.app_handle(), webview.label(), launch);
    urls.extend(space_windows::take_links(webview.label()));
    urls
}

/// The web addresses among a launch's arguments: what Windows passes Misty
/// as the default browser.
pub fn web_urls<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> Vec<String> {
    args.into_iter()
        .filter_map(|arg| {
            let arg = arg.as_ref();
            let url = url::Url::parse(arg).ok()?;
            (matches!(url.scheme(), "http" | "https") && arg.len() <= 8192).then(|| url.to_string())
        })
        .collect()
}

/// Windows lets an app register as a browser for the person (no
/// administrator needed) but never set itself as the default: Misty
/// registers, then opens Settings at its own default-apps page, where the
/// person chooses. The registration is written again on every request, so it
/// always names the running copy of Misty.
#[cfg(windows)]
mod windows {
    use crate::platform::shared_windows::registry::{read_string, write_string};

    const PROG_ID: &str = "MistyHTML";
    const CLIENT: &str = r"Software\Clients\StartMenuInternet\Misty";

    pub fn is_current() -> bool {
        ["http", "https"].iter().all(|scheme| {
            read_string(
                &format!(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\{scheme}\UserChoice"),
                "ProgId",
            )
            .ok()
            .flatten()
            .is_some_and(|id| id == PROG_ID)
        })
    }

    fn register() -> std::io::Result<()> {
        let exe = std::env::current_exe()?;
        let exe = exe.to_string_lossy();
        let open = format!("\"{exe}\" \"%1\"");
        let icon = format!("\"{exe}\",0");
        let classes = format!(r"Software\Classes\{PROG_ID}");
        write_string(&classes, "", "Misty HTML Document")?;
        write_string(&format!(r"{classes}\DefaultIcon"), "", &icon)?;
        write_string(&format!(r"{classes}\shell\open\command"), "", &open)?;
        write_string(CLIENT, "", "Misty")?;
        write_string(&format!(r"{CLIENT}\DefaultIcon"), "", &icon)?;
        write_string(
            &format!(r"{CLIENT}\shell\open\command"),
            "",
            &format!("\"{exe}\""),
        )?;
        let capabilities = format!(r"{CLIENT}\Capabilities");
        write_string(&capabilities, "ApplicationName", "Misty")?;
        write_string(&capabilities, "ApplicationIcon", &icon)?;
        write_string(
            &capabilities,
            "ApplicationDescription",
            "Misty's browser, with your agents beside every page.",
        )?;
        for scheme in ["http", "https"] {
            write_string(&format!(r"{capabilities}\URLAssociations"), scheme, PROG_ID)?;
        }
        for extension in [".htm", ".html"] {
            write_string(
                &format!(r"{capabilities}\FileAssociations"),
                extension,
                PROG_ID,
            )?;
        }
        write_string(
            r"Software\RegisteredApplications",
            "Misty",
            &format!(r"{CLIENT}\Capabilities"),
        )
    }

    pub fn request() {
        if register().is_err() {
            return;
        }
        // Settings opens at Misty's own page of default apps.
        let _ = tauri_plugin_opener::open_url(
            "ms-settings:defaultapps?registeredAppUser=Misty",
            None::<&str>,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::web_urls;

    #[test]
    fn only_web_addresses_are_taken_from_a_launch() {
        let urls = web_urls([
            r"C:\Program Files\Misty\misty.exe",
            "https://example.com/a?b=1",
            "misty://auth",
            "file:///C:/secret.txt",
            "--flag",
            "http://example.org",
        ]);
        assert_eq!(
            urls,
            vec!["https://example.com/a?b=1", "http://example.org/"]
        );
    }
}
