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

/// WebView2 uses folders rather than WK store identifiers. The native legacy
/// capture alias must refer to the already existing folder on this engine too.
pub(crate) fn relative_data_directory(profile: Option<&str>) -> Result<std::path::PathBuf, String> {
    data_store_identifier(profile)?;
    Ok(
        match profile.filter(|value| *value != legacy_profile_identity()) {
            Some(profile) => std::path::Path::new("browser-profiles").join(profile),
            None => std::path::PathBuf::from("browser-profile"),
        },
    )
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
        assert_eq!(
            relative_data_directory(None).unwrap(),
            relative_data_directory(Some(&legacy_profile_identity())).unwrap()
        );
        assert_eq!(
            relative_data_directory(None).unwrap(),
            std::path::Path::new("browser-profile")
        );
        assert_eq!(
            relative_data_directory(Some(&"01".repeat(32))).unwrap(),
            std::path::Path::new("browser-profiles").join("01".repeat(32))
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
            assert!(relative_data_directory(Some(value)).is_err());
        }
    }
}
