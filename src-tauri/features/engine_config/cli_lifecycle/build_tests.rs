// Codex's and Antigravity's builds, Hermes Agent's launchers outside Misty's folder, and what
// Misty's own copy of Claude Code gets when it runs.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::PathBuf;

use base64::Engine as _;

use super::downloads::{Checksum, Hasher};
use super::hermes_launchers;
use super::maker_builds::{self, antigravity, codex, Target};
use super::routes::{self, Route};
use crate::engines::support::paths::{own_copy_env_in, InstallRoot};

const FIXTURE: &[u8] = b"Misty checks every download.\n";
const FIXTURE_SHA256: &str = "aa131f23e45aaf3ea47b871577874cce99fc1e1e30d9c86f2e6f364491fd75c9";
const FIXTURE_SHA512: &str =
    "0WFRsFrPm0HlGLXvC+fHLBWwQAtqCgcmfjq5Zc4hSv1JQ3LaOHNsalNrvz/FaLZIFL9Yv5tjItE/W3zbaVqD+w==";

fn target(os: &'static str, arch: &'static str, musl: bool) -> Target<'static> {
    Target {
        os,
        arch,
        musl,
        avx2: true,
    }
}

/// A scratch home with Misty's install root inside it, gone when dropped.
struct Scratch {
    dir: PathBuf,
    root: InstallRoot,
}

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("misty-build-home-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(&dir).unwrap();
        let root = InstallRoot::at(dir.join(".misty").join("engines"));
        Self { dir, root }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn codex_comes_from_its_release_as_its_scripts_fetch_it() {
    let codex_target = |os, arch, musl| codex::codex_target(target(os, arch, musl));
    assert_eq!(
        codex_target("macos", "aarch64", false).as_deref(),
        Some("aarch64-apple-darwin")
    );
    // Linux builds are static, whatever the C library.
    assert_eq!(
        codex_target("linux", "x86_64", false).as_deref(),
        Some("x86_64-unknown-linux-musl")
    );
    assert_eq!(
        codex_target("windows", "x86_64", false).as_deref(),
        Some("x86_64-pc-windows-msvc")
    );
    assert_eq!(codex_target("linux", "riscv64", false), None);

    let asset = codex::package_name("aarch64-apple-darwin");
    assert_eq!(asset, "codex-package-aarch64-apple-darwin.tar.gz");
    let release = serde_json::json!({
        "tag_name": "rust-v0.168.0",
        "assets": [
            { "name": "codex-package_SHA256SUMS", "digest": "sha256:00" },
            { "name": asset, "digest": format!("sha256:{FIXTURE_SHA256}") },
            { "name": "codex-package-x86_64-apple-darwin.tar.gz", "digest": "md5:abc" },
        ]
    });
    assert_eq!(codex::release_version(&release).as_deref(), Some("0.168.0"));
    assert_eq!(
        codex::asset_checksum(&release, &asset),
        Checksum::sha256_hex(FIXTURE_SHA256)
    );
    assert_eq!(
        codex::asset_checksum(&release, "codex-package-x86_64-apple-darwin.tar.gz"),
        None
    );
    // A tag that isn't a plain version is never spliced into a download URL.
    let odd = serde_json::json!({ "tag_name": "rust-v0.1.0/../x" });
    assert_eq!(codex::release_version(&odd), None);
    assert_eq!(
        codex::release_version(&serde_json::json!({ "tag_name": "v1.0.0" })),
        None
    );
}

#[test]
fn antigravity_comes_from_its_manifest_checked_against_its_sha512() {
    let platform = |os, arch, musl| antigravity::agy_platform(target(os, arch, musl));
    assert_eq!(
        platform("macos", "aarch64", false).as_deref(),
        Some("darwin_arm64")
    );
    assert_eq!(
        platform("linux", "x86_64", true).as_deref(),
        Some("linux_amd64_musl")
    );
    assert_eq!(
        platform("windows", "x86_64", false).as_deref(),
        Some("windows_amd64")
    );

    let sha512_hex = hex::encode(
        base64::engine::general_purpose::STANDARD
            .decode(FIXTURE_SHA512)
            .unwrap(),
    );
    let checksum = Checksum::sha512_hex(&sha512_hex).unwrap();
    let mut hasher = Hasher::for_checksum(&checksum);
    hasher.update(FIXTURE);
    assert!(hasher.matches(&checksum));
    let mut wrong = Hasher::for_checksum(&checksum);
    wrong.update(b"something else");
    assert!(!wrong.matches(&checksum));
    assert_eq!(Checksum::sha512_hex("abc"), None);

    let manifest = serde_json::json!({
        "version": "1.5.8",
        "url": "https://storage.googleapis.com/antigravity-public/cli_mac_arm64.tar.gz",
        "sha512": sha512_hex.to_uppercase(),
    });
    let (version, url, found) = antigravity::manifest_build(&manifest).unwrap();
    assert_eq!(version, "1.5.8");
    assert!(url.ends_with(".tar.gz"));
    assert_eq!(found, checksum);
    let plain_http = serde_json::json!({
        "version": "1.5.8", "url": "http://example.com/agy", "sha512": sha512_hex,
    });
    assert_eq!(antigravity::manifest_build(&plain_http), None);
}

#[test]
fn codex_and_antigravity_install_as_builds_on_every_system() {
    for os in ["macos", "linux", "windows"] {
        for engine in ["codex", "agy"] {
            assert!(
                maker_builds::available(engine, target(os, "x86_64", false)),
                "{engine} on {os}"
            );
        }
    }
    let home = Scratch::new();
    let root = &home.root;
    let program = root.engine_dir("codex").join("bin").join("codex");
    std::fs::create_dir_all(program.parent().unwrap()).unwrap();
    std::fs::write(&program, "").unwrap();
    assert_eq!(
        routes::route_in(root, "codex", &program.to_string_lossy(), true, true),
        Some(Route::MistyDownload)
    );
    let steps = routes::plan_steps("codex", Route::MistyDownload, "codex", false);
    assert!(steps[0].contains("releases.openai.com"), "{steps:?}");
}

/// A launcher as Hermes writes it on Windows: distlib's stub, then the script stored as is.
fn exe_launcher(checkout: &str) -> Vec<u8> {
    let mut bytes = b"MZ\x90\x00stub\x00\x00#!\"C:\\py\\python.exe\" -I\r\nPK\x03\x04".to_vec();
    bytes.extend(format!("import os, re, sys\nsys.path.insert(0, {checkout})\n").as_bytes());
    bytes
}

/// The `.cmd` fallback, with the script in base64.
fn cmd_launcher(checkout: &str) -> String {
    let script = format!("import os, re, sys\nsys.path.insert(0, {checkout})\nimport x\n");
    let encoded = base64::engine::general_purpose::STANDARD.encode(script);
    format!(
        "@echo off\r\n\"C:\\py\\python.exe\" -I -c \"import base64; \
         exec(base64.b64decode('{encoded}'))\" %*\r\n"
    )
}

#[test]
fn a_hermes_launcher_says_which_checkout_it_starts() {
    let windows_path = r"'C:\\Users\\me\\.misty\\engines\\hermes\\hermes-agent'";
    let expected = r"C:\Users\me\.misty\engines\hermes\hermes-agent";
    assert_eq!(
        hermes_launchers::launcher_checkout(&exe_launcher(windows_path)).as_deref(),
        Some(expected)
    );
    assert_eq!(
        hermes_launchers::launcher_checkout(cmd_launcher(windows_path).as_bytes()).as_deref(),
        Some(expected)
    );
    // repr() switches to double quotes for a path with an apostrophe.
    assert_eq!(
        hermes_launchers::launcher_checkout(&exe_launcher(r#""C:\\O'Neil\\hermes-agent""#))
            .as_deref(),
        Some(r"C:\O'Neil\hermes-agent")
    );
    assert_eq!(
        hermes_launchers::launcher_checkout(b"MZ\x00not a launcher"),
        None
    );
}

#[test]
fn remove_takes_the_windows_launchers_of_mistys_checkout_and_no_others() {
    let home = Scratch::new();
    let root = &home.root;
    let checkout = root.checkout_dir("hermes");
    std::fs::create_dir_all(checkout.join(".hermes/bin")).unwrap();
    let bin = home.dir.join("AppData/Local/hermes/bin");
    std::fs::create_dir_all(&bin).unwrap();
    let dirs = vec![bin.clone()];
    let ours = format!("{:?}", checkout.to_string_lossy());
    // Before the install: nothing there. The install then writes these.
    let absent = hermes_launchers::absent(&dirs);
    std::fs::write(bin.join("hermes.exe"), exe_launcher(&ours)).unwrap();
    std::fs::write(bin.join("hermes-acp.exe"), b"MZ unreadable").unwrap();
    hermes_launchers::record_created(&root.engine_dir("hermes"), &absent).unwrap();
    // Later, the person's own Hermes, and a launcher Misty didn't write.
    std::fs::write(
        bin.join("hermes-acp.cmd"),
        cmd_launcher(r"'C:\\Users\\me\\hermes-agent'"),
    )
    .unwrap();
    std::fs::write(bin.join("hermes-agent.exe"), b"MZ someone else's").unwrap();

    let launcher = bin.join("hermes.exe").to_string_lossy().into_owned();
    assert!(routes::installed_by_misty_in(root, "hermes", &launcher));
    assert_eq!(
        routes::route_in(root, "hermes", &launcher, true, true),
        Some(Route::MistyScript)
    );
    routes::remove_in(root, &dirs, "hermes", &launcher).unwrap();
    assert!(!bin.join("hermes.exe").exists());
    assert!(!bin.join("hermes-acp.exe").exists(), "recorded at install");
    assert!(bin.join("hermes-acp.cmd").exists(), "another checkout");
    assert!(bin.join("hermes-agent.exe").exists(), "not Misty's");
    assert!(!root.engine_dir("hermes").exists());
}

#[test]
fn hermes_script_gets_a_home_inside_mistys_folder_on_macos_and_linux() {
    let into = std::path::Path::new("/home/me/.misty/engines/hermes/hermes-agent");
    assert_eq!(
        routes::installer_home("hermes", into, false),
        Some(PathBuf::from("/home/me/.misty/engines/hermes/home"))
    );
    assert_eq!(routes::installer_home("hermes", into, true), None);
    assert_eq!(routes::installer_home("codex", into, false), None);
}

#[test]
fn only_mistys_own_claude_code_runs_without_its_auto_updater() {
    let home = Scratch::new();
    let root = &home.root;
    let ours = maker_builds::program_path_in(root, "claude");
    std::fs::create_dir_all(ours.parent().unwrap()).unwrap();
    std::fs::write(&ours, "").unwrap();
    assert_eq!(
        own_copy_env_in(root, &ours.to_string_lossy()),
        vec![("DISABLE_AUTOUPDATER", "1")]
    );
    let theirs = home.dir.join(".local/bin/claude");
    assert!(own_copy_env_in(root, &theirs.to_string_lossy()).is_empty());
    assert!(own_copy_env_in(root, "claude").is_empty());
    let codex = maker_builds::program_path_in(root, "codex");
    assert!(own_copy_env_in(root, &codex.to_string_lossy()).is_empty());
}
