use super::*;

#[test]
fn platform_selection_defaults_to_host() {
    let selected = selected_platforms(&[]);
    if cfg!(target_os = "macos") {
        assert_eq!(selected.unwrap(), [MACOS_PLATFORM]);
    } else if cfg!(windows) {
        assert_eq!(selected.unwrap(), [WINDOWS_PLATFORM, WINDOWS_ARM_PLATFORM]);
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        assert_eq!(selected.unwrap(), [LINUX_PLATFORM]);
    } else {
        assert!(selected.is_err());
    }
}

#[test]
fn platform_selection_accepts_explicit_platforms_without_duplicates() {
    assert_eq!(
        selected_platforms(&[ReleaseOs::Macos]).unwrap(),
        [MACOS_PLATFORM]
    );
    assert_eq!(
        selected_platforms(&[ReleaseOs::Windows]).unwrap(),
        [WINDOWS_PLATFORM, WINDOWS_ARM_PLATFORM]
    );
    assert_eq!(
        selected_platforms(&[ReleaseOs::Windows, ReleaseOs::Macos, ReleaseOs::Windows]).unwrap(),
        [MACOS_PLATFORM, WINDOWS_PLATFORM, WINDOWS_ARM_PLATFORM]
    );
    assert_eq!(
        selected_platforms(&[ReleaseOs::Linux, ReleaseOs::Macos]).unwrap(),
        [MACOS_PLATFORM, LINUX_PLATFORM]
    );
}

#[test]
fn a_test_build_keeps_the_release_policy_without_signing() {
    let build = config::test_build();
    assert_eq!(build["app"]["security"]["csp"], config::csp());
    assert_eq!(build["bundle"]["createUpdaterArtifacts"], false);
    assert!(build["bundle"].get("windows").is_none());
}

/// Agents run inside the app, so a build bundles no second program or its files, and the app doesn't
/// need the JIT rights Node did.
#[test]
fn no_release_ships_node() {
    std::env::set_var("TAURI_UPDATER_PUBLIC_KEY", format!("RW{}", "a".repeat(54)));
    for build in [config::test_build(), config::build().unwrap()] {
        assert!(build["bundle"].get("externalBin").is_none());
        assert!(build["bundle"].get("resources").is_none());
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    let entitlements = std::path::Path::new(manifest).join("../src-tauri/packaging/Entitlements.plist");
    let entitlements = std::fs::read_to_string(entitlements).unwrap();
    assert!(!entitlements.contains("allow-jit"));
    assert!(!entitlements.contains("allow-unsigned-executable-memory"));
}
