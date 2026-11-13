//! A profile's website data store: the engine's cookies, site storage and cache for that profile's
//! pages. A profile has exactly one, and which one comes from `browser::app_windows`. A store is named by
//! a 64-character identity; `None` is this computer's original store.
#[cfg(target_os = "macos")]
use file_access::fs;
// The store this computer has always browsed in, kept so nobody is signed out of their sites.
const ORIGINAL_STORE_ID: [u8; 16] = [
    0x68, 0x25, 0x8f, 0x34, 0x88, 0x8a, 0x4a, 0xbd, 0xa6, 0x21, 0x8f, 0x4c, 0xe2, 0x63, 0x71, 0x96,
];

/// Native-only alias for reading the existing embedded browser store during
/// explicit initial capture. Never use the application's authentication store.
pub(crate) fn original_store_identity() -> String {
    let mut identity: String = ORIGINAL_STORE_ID
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    identity.push_str(&"0".repeat(32));
    identity
}

/// The folder a store's website data is found in, under Misty's own:
/// `~/.misty/profiles/<store>/webview`. WebView2 and WebKitGTK keep the data right there.
/// WebKit on macOS chooses its own folder for a store, so there it is a symlink to that
/// folder (see `link_store_data`). The original store is `default`.
pub(crate) fn store_home(
    home: &std::path::Path,
    store: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    data_store_identifier(store)?;
    let name = store
        .filter(|value| *value != original_store_identity())
        .unwrap_or("default");
    Ok(home.join("profiles").join(name).join("webview"))
}

/// The identifier WebKit knows a store by in this build. Every build of one app id shares
/// WebKit's folder of stores (macOS picks it from the app id, not from Misty's data folder), so
/// a dev or named build mixes its profile into the identifier and gets stores of its own. Release
/// builds keep the store's own identifier, so every release version, before and after an update,
/// browses in the same store.
pub fn webkit_store_identifier(store: Option<&str>) -> Result<[u8; 16], String> {
    Ok(for_profile(
        data_store_identifier(store)?,
        file_access::paths::profile(),
    ))
}

fn for_profile(identifier: [u8; 16], profile: &file_access::paths::Profile) -> [u8; 16] {
    use sha2::{Digest, Sha256};
    if matches!(profile, file_access::paths::Profile::Release { .. }) {
        return identifier;
    }
    let mut hash = Sha256::new();
    hash.update(b"misty-webkit-store\0");
    hash.update(profile.relative().to_string_lossy().as_bytes());
    hash.update(b"\0");
    hash.update(identifier);
    let mut mixed = [0; 16];
    mixed.copy_from_slice(&hash.finalize()[..16]);
    mixed
}

/// WebKit's folder for a store: `~/Library/WebKit/<bundle id>/WebsiteDataStore/<uuid>`.
#[cfg(target_os = "macos")]
fn webkit_store_folder(
    library: &std::path::Path,
    bundle_identifier: &str,
    identifier: [u8; 16],
) -> std::path::PathBuf {
    library
        .join("WebKit")
        .join(bundle_identifier)
        .join("WebsiteDataStore")
        .join(uuid::Uuid::from_bytes(identifier).hyphenated().to_string())
}

/// On macOS, WebKit keeps a store at
/// `~/Library/WebKit/<bundle id>/WebsiteDataStore/<uuid>`, where the uuid is the store's
/// identifier in this build (`webkit_store_identifier`). Points `webview` at it so a store's data
/// is reachable from Misty's folder. The store may not exist yet (WebKit creates it on first
/// use); the link is then dangling until it does. Never removes anything it does not own.
///
/// A dev or named build's store that doesn't exist yet starts as a copy of the one every build
/// shared before stores were separated, so that build stays signed in to its sites.
#[cfg(target_os = "macos")]
pub(crate) fn link_store_data(
    home: &std::path::Path,
    library: &std::path::Path,
    bundle_identifier: &str,
    store: Option<&str>,
    profile: &file_access::paths::Profile,
) -> Result<(), String> {
    let shared = data_store_identifier(store)?;
    let identifier = for_profile(shared, profile);
    let target = webkit_store_folder(library, bundle_identifier, identifier);
    if identifier != shared && !fs::exists(&target) {
        let before = webkit_store_folder(library, bundle_identifier, shared);
        if fs::is_dir(&before) {
            // A copy that fails leaves the build a fresh store, signed out, which still works.
            if fs::copy_tree(&before, &target).is_err() {
                let _ = fs::remove_dir_all(&target);
            }
        }
    }
    let link = store_home(home, store)?;
    fs::create_dir_all(link.parent().ok_or("Invalid store folder.")?)
        .map_err(|error| error.to_string())?;
    match fs::symlink_metadata(&link) {
        Ok(meta) if meta.file_type().is_symlink() => {
            if fs::read_link(&link).is_ok_and(|current| current == target) {
                return Ok(());
            }
            fs::remove_file(&link).map_err(|error| error.to_string())?;
        }
        // An empty folder from an earlier layout gives way; one with files is left alone.
        Ok(meta) if meta.is_dir() => {
            if fs::remove_dir(&link).is_err() {
                return Ok(());
            }
        }
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    fs::symlink(&target, &link).map_err(|error| error.to_string())
}

/// The host supplies a validated 256-bit identity (logical hash or native
/// generation), never a filesystem path. WebKit uses the first 128 bits.
pub fn data_store_identifier(store: Option<&str>) -> Result<[u8; 16], String> {
    let Some(store) = store else {
        return Ok(ORIGINAL_STORE_ID);
    };
    if store.len() != 64
        || !store
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Invalid website data store.".to_owned());
    }
    let mut identifier = [0; 16];
    for (index, byte) in identifier.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&store[index * 2..index * 2 + 2], 16)
            .map_err(|_| "Invalid website data store.".to_owned())?;
    }
    Ok(identifier)
}

#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests {
    use super::*;

    #[test]
    fn preserves_legacy_store_and_derives_distinct_account_stores() {
        assert_eq!(data_store_identifier(None).unwrap(), ORIGINAL_STORE_ID);
        assert_eq!(
            data_store_identifier(Some(&original_store_identity())).unwrap(),
            ORIGINAL_STORE_ID
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
            store_home(home, None).unwrap(),
            store_home(home, Some(&original_store_identity())).unwrap()
        );
        assert_eq!(
            store_home(home, None).unwrap(),
            home.join("profiles").join("default").join("webview")
        );
        assert_eq!(
            store_home(home, Some(&"01".repeat(32))).unwrap(),
            home.join("profiles").join("01".repeat(32)).join("webview")
        );
    }

    #[test]
    fn rejects_paths_aliases_and_malformed_identities() {
        for value in [
            "../private",
            "",
            "../../browser-store",
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
            assert!(store_home(std::path::Path::new("/x"), Some(value)).is_err());
        }
    }

    #[test]
    fn release_builds_share_a_store_and_dev_builds_get_their_own() {
        use file_access::paths::Profile;
        let shared = data_store_identifier(Some(&"01".repeat(32))).unwrap();
        let beta = file_access::paths::profile_for("0.1.0-beta.1", false, None);
        let stable = file_access::paths::profile_for("0.2.0", false, None);
        assert_eq!(for_profile(shared, &beta), shared);
        assert_eq!(for_profile(shared, &stable), shared);
        let dev = for_profile(shared, &Profile::Dev("default".into()));
        let work = for_profile(shared, &Profile::Dev("work".into()));
        let named = for_profile(shared, &Profile::Custom("default".into()));
        assert_ne!(dev, shared);
        assert_ne!(dev, work);
        assert_ne!(dev, named);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_dev_build_starts_its_store_from_the_shared_one() {
        let directory = tempfile::tempdir().unwrap();
        let (home, library) = (
            directory.path().join(".misty"),
            directory.path().join("Library"),
        );
        let store = "01".repeat(32);
        let shared = library
            .join("WebKit/com.misty.desktop/WebsiteDataStore/01010101-0101-0101-0101-010101010101");
        std::fs::create_dir_all(&shared).unwrap();
        std::fs::write(shared.join("cookies"), "signed in").unwrap();
        let dev = file_access::paths::Profile::Dev("default".into());

        link_store_data(&home, &library, "com.misty.desktop", Some(&store), &dev).unwrap();

        let link = store_home(&home, Some(&store)).unwrap();
        let own = std::fs::read_link(&link).unwrap();
        assert_ne!(own, shared);
        assert_eq!(std::fs::read_to_string(own.join("cookies")).unwrap(), "signed in");
        // The shared store stays as it was, for the release build.
        assert!(shared.join("cookies").is_file());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_links_the_profile_to_webkits_own_store_and_removes_only_its_own_link() {
        let directory = tempfile::tempdir().unwrap();
        let (home, library) = (
            directory.path().join(".misty"),
            directory.path().join("Library"),
        );
        let store = "01".repeat(32);
        let release = file_access::paths::profile_for("1.0.0", false, None);
        link_store_data(&home, &library, "com.misty.desktop", Some(&store), &release).unwrap();
        let link = store_home(&home, Some(&store)).unwrap();
        let target = std::fs::read_link(&link).unwrap();
        assert!(target.ends_with(
            "WebKit/com.misty.desktop/WebsiteDataStore/01010101-0101-0101-0101-010101010101"
        ));
        // A second call keeps it; the store appearing later makes it resolve.
        link_store_data(&home, &library, "com.misty.desktop", Some(&store), &release).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("cookies"), "kept").unwrap();
        assert!(link.join("cookies").is_file());
        // Deleting the profile's folder removes the link, never what it points to.
        std::fs::remove_dir_all(link.parent().unwrap()).unwrap();
        assert!(target.join("cookies").is_file());
    }
}
