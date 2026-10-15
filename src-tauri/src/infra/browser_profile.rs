// Retain the pre-SDK browser profile for existing embedded tabs.
const LEGACY_STORE_ID: [u8; 16] = [
    0x68, 0x25, 0x8f, 0x34, 0x88, 0x8a, 0x4a, 0xbd, 0xa6, 0x21, 0x8f, 0x4c, 0xe2, 0x63, 0x71, 0x96,
];

/// Native-only alias for reading the existing embedded browser store during
/// explicit initial capture. Never use the application's authentication store.
pub(crate) fn legacy_profile_identity() -> String {
    let mut identity: String = LEGACY_STORE_ID
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    identity.push_str(&"0".repeat(32));
    identity
}

/// The folder a profile's website data is found in, under Misty's own:
/// `~/.misty/profiles/<profile>/webview`. WebView2 and WebKitGTK keep the data right there.
/// WebKit on macOS chooses its own folder for a store, so there it is a symlink to that
/// folder (see `link_webview_data`). The default and legacy profiles are `default`.
pub(crate) fn webview_home(
    home: &std::path::Path,
    profile: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    data_store_identifier(profile)?;
    let name = profile
        .filter(|value| *value != legacy_profile_identity())
        .unwrap_or("default");
    // A development profile keeps its own website data beside the others.
    let folder = match std::env::var("MISTY_PROFILE") {
        Ok(dev) if !dev.is_empty() => format!("{dev}-{name}"),
        _ => name.to_owned(),
    };
    Ok(home.join("profiles").join(folder).join("webview"))
}

/// On macOS, WebKit keeps a store at
/// `~/Library/WebKit/<bundle id>/WebsiteDataStore/<uuid>`, where the uuid is the store's
/// identifier. Points `webview` at it so a profile's data is reachable from Misty's folder.
/// The store may not exist yet (WebKit creates it on first use); the link is then dangling
/// until it does. Never removes anything it does not own.
#[cfg(target_os = "macos")]
pub(crate) fn link_webview_data(
    home: &std::path::Path,
    library: &std::path::Path,
    bundle_identifier: &str,
    profile: Option<&str>,
) -> Result<(), String> {
    let identifier = data_store_identifier(profile)?;
    let target = library
        .join("WebKit")
        .join(bundle_identifier)
        .join("WebsiteDataStore")
        .join(uuid::Uuid::from_bytes(identifier).hyphenated().to_string());
    let link = webview_home(home, profile)?;
    std::fs::create_dir_all(link.parent().ok_or("Invalid profile folder.")?)
        .map_err(|error| error.to_string())?;
    match std::fs::symlink_metadata(&link) {
        Ok(meta) if meta.file_type().is_symlink() => {
            if std::fs::read_link(&link).is_ok_and(|current| current == target) {
                return Ok(());
            }
            std::fs::remove_file(&link).map_err(|error| error.to_string())?;
        }
        // An empty folder from an earlier layout gives way; one with files is left alone.
        Ok(meta) if meta.is_dir() => {
            if std::fs::remove_dir(&link).is_err() {
                return Ok(());
            }
        }
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    std::os::unix::fs::symlink(&target, &link).map_err(|error| error.to_string())
}

/// The host supplies a validated 256-bit identity (logical hash or native
/// generation), never a filesystem path. WebKit uses the first 128 bits.
pub fn data_store_identifier(profile: Option<&str>) -> Result<[u8; 16], String> {
    let Some(profile) = profile else {
        return Ok(LEGACY_STORE_ID);
    };
    if profile.len() != 64
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Invalid browser profile identity.".to_owned());
    }
    let mut identifier = [0; 16];
    for (index, byte) in identifier.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&profile[index * 2..index * 2 + 2], 16)
            .map_err(|_| "Invalid browser profile identity.".to_owned())?;
    }
    Ok(identifier)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_legacy_store_and_derives_distinct_account_stores() {
        assert_eq!(data_store_identifier(None).unwrap(), LEGACY_STORE_ID);
        assert_eq!(
            data_store_identifier(Some(&legacy_profile_identity())).unwrap(),
            LEGACY_STORE_ID
        );
        assert_eq!(
            data_store_identifier(Some(&"01".repeat(32))).unwrap(),
            [1; 16]
        );
        assert_ne!(
            data_store_identifier(Some(&"02".repeat(32))).unwrap(),
            [1; 16]
        );
        let home = std::path::Path::new("/home/me/.misty");
        assert_eq!(
            webview_home(home, None).unwrap(),
            webview_home(home, Some(&legacy_profile_identity())).unwrap()
        );
        assert_eq!(
            webview_home(home, None).unwrap(),
            home.join("profiles").join("default").join("webview")
        );
        assert_eq!(
            webview_home(home, Some(&"01".repeat(32))).unwrap(),
            home.join("profiles").join("01".repeat(32)).join("webview")
        );
    }

    #[test]
    fn rejects_paths_aliases_and_malformed_identities() {
        for value in [
            "../private",
            "",
            "../../browser-profile",
            &"0".repeat(63),
            &"0".repeat(65),
            &"A".repeat(64),
            &"g".repeat(64),
            &"é".repeat(32),
        ] {
            assert!(
                data_store_identifier(Some(value)).is_err(),
                "accepted {value}"
            );
            assert!(webview_home(std::path::Path::new("/x"), Some(value)).is_err());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_links_the_profile_to_webkits_own_store_and_removes_only_its_own_link() {
        let directory = tempfile::tempdir().unwrap();
        let (home, library) = (
            directory.path().join(".misty"),
            directory.path().join("Library"),
        );
        let profile = "01".repeat(32);
        link_webview_data(&home, &library, "com.misty.desktop", Some(&profile)).unwrap();
        let link = webview_home(&home, Some(&profile)).unwrap();
        let target = std::fs::read_link(&link).unwrap();
        assert!(target.ends_with(
            "WebKit/com.misty.desktop/WebsiteDataStore/01010101-0101-0101-0101-010101010101"
        ));
        // A second call keeps it; the store appearing later makes it resolve.
        link_webview_data(&home, &library, "com.misty.desktop", Some(&profile)).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("cookies"), "kept").unwrap();
        assert!(link.join("cookies").is_file());
        // Deleting the profile's folder removes the link, never what it points to.
        std::fs::remove_dir_all(link.parent().unwrap()).unwrap();
        assert!(target.join("cookies").is_file());
    }
}
