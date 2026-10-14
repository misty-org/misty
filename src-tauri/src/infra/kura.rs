//! Hand-offs to Kura, the separate, account-free file manager. Misty only opens
//! `kura://` links; Kura decides what to show.
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Deserialize;

use crate::error::{ApiError, ApiResult};

/// Kura's bundle identifier on macOS.
const KURA_BUNDLE_ID: &str = "com.misty.kura";

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum KuraLink {
    Search {
        query: String,
    },
    Open {
        path: String,
        select: Option<String>,
    },
}

impl KuraLink {
    fn url(&self) -> ApiResult<String> {
        let encode = |value: &str| utf8_percent_encode(value, NON_ALPHANUMERIC).to_string();
        match self {
            Self::Search { query } => {
                let query = query.trim();
                if query.is_empty() || query.len() > 1024 {
                    return Err(ApiError::Message("Enter a shorter search for Kura.".into()));
                }
                Ok(format!("kura://search?q={}", encode(query)))
            }
            Self::Open { path, select } => {
                if path.is_empty() || !std::path::Path::new(path).is_absolute() {
                    return Err(ApiError::Message("Kura opens absolute paths only.".into()));
                }
                let mut url = format!("kura://open?path={}", encode(path));
                if let Some(select) = select.as_deref().filter(|value| !value.is_empty()) {
                    url.push_str(&format!("&select={}", encode(select)));
                }
                Ok(url)
            }
        }
    }
}

/// Whether some app on this computer handles `kura://` links.
#[tauri::command]
pub async fn kura_installed() -> bool {
    tokio::task::spawn_blocking(kura_handler_installed)
        .await
        .unwrap_or(false)
}

/// Opens a search or a file in Kura. Fails when Kura is not installed.
#[tauri::command]
pub async fn kura_open(link: KuraLink) -> ApiResult<()> {
    let url = link.url()?;
    if !kura_installed().await {
        return Err(ApiError::Unavailable("Kura isn't installed.".into()));
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|error| ApiError::Message(format!("Kura could not be opened: {error}")))
}

#[cfg(target_os = "macos")]
fn kura_handler_installed() -> bool {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use std::ffi::c_void;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyApplicationURLsForBundleIdentifier(
            bundle_id: CFStringRef,
            error: *mut *mut c_void,
        ) -> *const c_void;
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFRelease(object: *const c_void);
    }

    let bundle_id = CFString::new(KURA_BUNDLE_ID);
    // SAFETY: the bundle id outlives the call; the returned array follows the
    // Create rule and is released here.
    unsafe {
        let urls = LSCopyApplicationURLsForBundleIdentifier(
            bundle_id.as_concrete_TypeRef(),
            std::ptr::null_mut(),
        );
        if urls.is_null() {
            return false;
        }
        let found = CFArrayGetCount(urls) > 0;
        CFRelease(urls);
        found
    }
}

/// A `kura` key under HKEY_CLASSES_ROOT marked as a URL protocol.
#[cfg(windows)]
fn kura_handler_installed() -> bool {
    use crate::platform::windows::wide;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ,
    };
    let key_name = wide("kura");
    let value_name = wide("URL Protocol");
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: NUL-terminated names; the opened key is closed below.
    unsafe {
        if RegOpenKeyExW(HKEY_CLASSES_ROOT, key_name.as_ptr(), 0, KEY_READ, &mut key) != 0 {
            return false;
        }
        let found = RegQueryValueExW(
            key,
            value_name.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        ) == 0;
        RegCloseKey(key);
        found
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn kura_handler_installed() -> bool {
    std::process::Command::new("xdg-mime")
        .args(["query", "default", "x-scheme-handler/kura"])
        .output()
        .is_ok_and(|output| output.status.success() && !output.stdout.trim_ascii().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_encode_their_values() {
        let search = KuraLink::Search {
            query: "tax 2026 & receipts".into(),
        };
        assert_eq!(
            search.url().unwrap(),
            "kura://search?q=tax%202026%20%26%20receipts"
        );
        #[cfg(not(windows))]
        let (path, select, expected) = (
            "/Users/ada/My Docs",
            "/Users/ada/My Docs/a.pdf",
            "kura://open?path=%2FUsers%2Fada%2FMy%20Docs&select=%2FUsers%2Fada%2FMy%20Docs%2Fa%2Epdf",
        );
        #[cfg(windows)]
        let (path, select, expected) = (
            r"C:\Users\ada\My Docs",
            r"C:\Users\ada\My Docs\a.pdf",
            "kura://open?path=C%3A%5CUsers%5Cada%5CMy%20Docs&select=C%3A%5CUsers%5Cada%5CMy%20Docs%5Ca%2Epdf",
        );
        let open = KuraLink::Open {
            path: path.into(),
            select: Some(select.into()),
        };
        assert_eq!(open.url().unwrap(), expected);
    }

    #[test]
    fn links_reject_relative_paths_and_empty_searches() {
        assert!(KuraLink::Open {
            path: "docs".into(),
            select: None
        }
        .url()
        .is_err());
        assert!(KuraLink::Search { query: "  ".into() }.url().is_err());
    }
}
