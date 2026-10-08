use serde::Serialize;

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
    #[cfg(not(target_os = "macos"))]
    {
        DefaultBrowserSnapshot {
            supported: false,
            is_default: false,
        }
    }
}

/// Asks the OS to make Misty the default browser. macOS confirms with the user
/// asynchronously, so the returned snapshot may not reflect the answer yet.
pub fn request() -> DefaultBrowserSnapshot {
    #[cfg(target_os = "macos")]
    unsafe {
        misty_default_browser_request();
    }
    snapshot()
}
