use super::*;

#[test]
fn platform_selection_defaults_to_host() {
    let selected = selected_platforms(&[]);
    if cfg!(target_os = "macos") {
        assert_eq!(selected.unwrap(), [MACOS_PLATFORM]);
    } else if cfg!(windows) {
        assert_eq!(selected.unwrap(), [WINDOWS_PLATFORM, WINDOWS_ARM_PLATFORM]);
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
}

#[test]
fn a_test_build_keeps_the_release_policy_without_signing() {
    let plain = config::test_build(false);
    assert_eq!(plain["app"]["security"]["csp"], config::csp());
    assert_eq!(plain["bundle"]["createUpdaterArtifacts"], false);
    assert!(plain["bundle"].get("windows").is_none());
    assert!(plain["bundle"].get("externalBin").is_none());

    let agents = config::test_build(true);
    assert_eq!(agents["bundle"]["externalBin"][0], "binaries/misty-node");
    assert!(agents["bundle"]["resources"].is_object());
}
