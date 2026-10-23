use super::*;

#[test]
fn reads_firefox_profiles_with_the_installed_default_first() {
    let dir = tempfile::tempdir().unwrap();
    for profile in ["Profiles/a.default", "Profiles/b.default-release"] {
        std::fs::create_dir_all(dir.path().join(profile)).unwrap();
        std::fs::write(dir.path().join(profile).join("places.sqlite"), b"").unwrap();
    }
    std::fs::write(
        dir.path().join("profiles.ini"),
        "[Profile1]\nName=default\nIsRelative=1\nPath=Profiles/a.default\n\n\
             [Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/b.default-release\n\n\
             [Install4F96D1932A9F858E]\nDefault=Profiles/b.default-release\nLocked=1\n",
    )
    .unwrap();
    let profiles = firefox_profiles(dir.path());
    assert_eq!(
        profiles.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        ["default-release", "default"]
    );
}

#[test]
fn reads_chromium_profiles_from_local_state() {
    let dir = tempfile::tempdir().unwrap();
    for profile in ["Default", "Profile 1", "Empty"] {
        std::fs::create_dir_all(dir.path().join(profile)).unwrap();
    }
    std::fs::write(dir.path().join("Default/Bookmarks"), b"{}").unwrap();
    std::fs::write(dir.path().join("Profile 1/History"), b"").unwrap();
    std::fs::write(
            dir.path().join("Local State"),
            r#"{"profile":{"info_cache":{"Default":{"name":"Personal"},"Profile 1":{"name":"Work"},"Empty":{"name":"Empty"},"../x":{"name":"Bad"}}}}"#,
        )
        .unwrap();
    let profiles = chromium_profiles(dir.path());
    assert_eq!(
        profiles
            .iter()
            .map(|p| (p.id.as_str(), p.name.as_str()))
            .collect::<Vec<_>>(),
        [("Default", "Personal"), ("Profile 1", "Work")]
    );
}
