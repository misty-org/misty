#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use super::downloads::{self, Checksum, Hasher};
use super::maker_builds::{self, Target};
use super::node_runtime::{self, NODE_VERSION};

const FIXTURE: &[u8] = b"Misty checks every download.\n";
const FIXTURE_SHA256: &str = "aa131f23e45aaf3ea47b871577874cce99fc1e1e30d9c86f2e6f364491fd75c9";
const FIXTURE_SHA512: &str =
    "0WFRsFrPm0HlGLXvC+fHLBWwQAtqCgcmfjq5Zc4hSv1JQ3LaOHNsalNrvz/FaLZIFL9Yv5tjItE/W3zbaVqD+w==";

#[test]
fn downloads_are_kept_only_when_they_match_the_published_checksum() {
    let dir = std::env::temp_dir().join(format!("misty-checksum-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("fixture.bin");
    std::fs::write(&file, FIXTURE).unwrap();

    let sha256 = Checksum::sha256_hex(FIXTURE_SHA256).unwrap();
    assert!(downloads::file_matches(&file, &sha256).unwrap());
    let upper = Checksum::sha256_hex(&FIXTURE_SHA256.to_ascii_uppercase()).unwrap();
    assert!(downloads::file_matches(&file, &upper).unwrap());
    let sha512 = Checksum::from_npm_integrity(&format!("sha512-{FIXTURE_SHA512}")).unwrap();
    assert!(downloads::file_matches(&file, &sha512).unwrap());

    std::fs::write(&file, b"Misty checks every download!\n").unwrap();
    assert!(!downloads::file_matches(&file, &sha256).unwrap());
    assert!(!downloads::file_matches(&file, &sha512).unwrap());
    let mut hasher = Hasher::for_checksum(&sha256);
    hasher.update(FIXTURE);
    assert!(!hasher.matches(&sha512));

    assert_eq!(Checksum::sha256_hex("abc"), None);
    assert_eq!(Checksum::sha256_hex(&"z".repeat(64)), None);
    assert_eq!(Checksum::from_npm_integrity("sha1-abc"), None);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn node_comes_from_its_shasums_line() {
    let file = format!("node-v{NODE_VERSION}-darwin-arm64.tar.gz");
    let shasums = format!(
        "{}  node-v{NODE_VERSION}-darwin-arm64.tar.xz\n{FIXTURE_SHA256}  {file}\n\
         {}  node-v{NODE_VERSION}-win-x64.zip\n",
        "1".repeat(64),
        "2".repeat(64)
    );
    assert_eq!(
        downloads::sha256_from_shasums(&shasums, &file),
        Checksum::sha256_hex(FIXTURE_SHA256)
    );
    assert_eq!(
        downloads::sha256_from_shasums(&shasums, "node-v0-linux-x64.tar.gz"),
        None
    );
    assert_eq!(downloads::sha256_from_shasums(&shasums, "node"), None);

    let archive = node_runtime::node_archive("macos", "aarch64").unwrap();
    assert_eq!(archive.file, file);
    assert_eq!(
        node_runtime::archive_url(&archive),
        format!("https://nodejs.org/dist/v{NODE_VERSION}/{file}")
    );
    assert_eq!(
        node_runtime::node_archive("windows", "x86_64")
            .unwrap()
            .file,
        format!("node-v{NODE_VERSION}-win-x64.zip")
    );
    assert_eq!(
        node_runtime::node_archive("linux", "x86_64")
            .unwrap()
            .folder,
        format!("node-v{NODE_VERSION}-linux-x64")
    );
    assert_eq!(node_runtime::node_archive("freebsd", "x86_64"), None);
    assert_eq!(node_runtime::node_archive("linux", "riscv64"), None);
}

#[test]
fn makers_builds_are_picked_for_this_system() {
    let target = |os, arch, musl, avx2| Target {
        os,
        arch,
        musl,
        avx2,
    };
    assert_eq!(
        maker_builds::claude_platform(target("macos", "aarch64", false, true)).as_deref(),
        Some("darwin-arm64")
    );
    assert_eq!(
        maker_builds::claude_platform(target("linux", "x86_64", true, true)).as_deref(),
        Some("linux-x64-musl")
    );
    assert_eq!(
        maker_builds::claude_platform(target("windows", "aarch64", false, true)).as_deref(),
        Some("win32-arm64")
    );
    assert_eq!(
        maker_builds::opencode_target(target("linux", "x86_64", true, false)).as_deref(),
        Some("linux-x64-baseline-musl")
    );
    assert_eq!(
        maker_builds::opencode_target(target("macos", "x86_64", false, true)).as_deref(),
        Some("darwin-x64")
    );
    assert_eq!(
        maker_builds::opencode_target(target("windows", "x86_64", false, true)),
        None
    );

    let manifest = serde_json::json!({
        "version": "2.1.0",
        "platforms": {
            "darwin-arm64": { "binary": "claude", "checksum": FIXTURE_SHA256, "size": 29 },
            "linux-x64": { "binary": "claude", "checksum": "not-a-hash" },
        }
    });
    assert_eq!(
        maker_builds::claude_checksum(&manifest, "darwin-arm64"),
        Checksum::sha256_hex(FIXTURE_SHA256)
    );
    assert_eq!(maker_builds::claude_checksum(&manifest, "linux-x64"), None);
    assert_eq!(maker_builds::claude_checksum(&manifest, "win32-x64"), None);
}
