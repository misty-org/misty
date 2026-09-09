// Retain the pre-SDK browser profile for existing embedded tabs.
const LEGACY_STORE_ID: [u8; 16] = [
    0x68, 0x25, 0x8f, 0x34, 0x88, 0x8a, 0x4a, 0xbd, 0xa6, 0x21, 0x8f, 0x4c, 0xe2, 0x63, 0x71, 0x96,
];

/// The Host supplies a SHA-256 identity, never a path or caller-selected store.
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
            data_store_identifier(Some(&"01".repeat(32))).unwrap(),
            [1; 16]
        );
        assert_ne!(
            data_store_identifier(Some(&"02".repeat(32))).unwrap(),
            [1; 16]
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
        }
    }
}
