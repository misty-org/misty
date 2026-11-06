//! What the native host's checks answer, without running an extension.
use std::ffi::{c_char, CString};
extern "C" {
    fn misty_extensions_compat_requires(method: *const c_char, permission: *const c_char) -> bool;
    fn misty_extensions_download_header_allowed(name: *const c_char) -> bool;
}
fn requires(method: &str, permission: &str) -> bool {
    let (method, permission) = (
        CString::new(method).unwrap(),
        CString::new(permission).unwrap(),
    );
    unsafe { misty_extensions_compat_requires(method.as_ptr(), permission.as_ptr()) }
}
fn header(name: &str) -> bool {
    let name = CString::new(name).unwrap();
    unsafe { misty_extensions_download_header_allowed(name.as_ptr()) }
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
    // `nil` compares equal to nothing, so neither of these says yes.
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
