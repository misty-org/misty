//! What the native host's checks answer, without running an extension.
use super::super::macos::{compat_requires, download_header_allowed};
fn requires(method: &str, permission: &str) -> bool {
    compat_requires(method, permission)
}
fn header(name: &str) -> bool {
    download_header_allowed(name)
}

#[test]
fn each_compat_namespace_needs_its_own_permission() {
    for (method, permission) in [
        ("downloads.search", "downloads"),
        ("downloads.download", "downloads"),
        ("history.search", "history"),
        ("bookmarks.getTree", "bookmarks"),
        ("browsingData.remove", "browsingData"),
        ("userScripts.write", "userScripts"),
        ("notifications.create", "notifications"),
        ("tabGroups.query", "tabGroups"),
    ] {
        assert!(requires(method, permission), "{method}");
        assert!(!requires(method, ""), "{method} is open to every extension");
        assert!(!requires(method, "storage"), "{method}");
    }
    assert!(requires("tabs.move", ""));
}

#[test]
fn no_extension_can_open_a_download_and_unknown_calls_are_refused() {
    // An unknown call compares equal to nothing, so neither of these says yes.
    for permission in ["downloads", "downloads.open", ""] {
        assert!(!requires("downloads.open", permission), "{permission}");
    }
    for method in ["vault.read", "passwords.get", "tauri.invoke", ""] {
        for permission in ["", "downloads", "vault", "passwords", "tauri"] {
            assert!(!requires(method, permission), "{method} {permission}");
        }
    }
}

#[test]
fn a_download_cannot_pass_as_another_sites_request() {
    for name in [
        "Cookie",
        "cookie",
        "Origin",
        "Referer",
        "Host",
        "Sec-Fetch-Site",
        "Proxy-Authorization",
    ] {
        assert!(!header(name), "{name}");
    }
    for name in ["Authorization", "Accept", "X-Custom", "User-Agent"] {
        assert!(header(name), "{name}");
    }
}
