// Where Misty installs engines and Node.js, how a download is checked, and the order engines are
// found in: the program path from Settings, then a copy already on the computer, then Misty's own.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::path::{Path, PathBuf};

use super::downloads::{self, Checksum, Hasher};
use super::maker_builds::{self, Target};
use super::node_runtime::{self, NODE_VERSION};
use super::routes::{self, Route};
use crate::engines::support::paths::InstallRoot;

/// The fixture every checksum test hashes, and its published hashes.
const FIXTURE: &[u8] = b"Misty checks every download.\n";
const FIXTURE_SHA256: &str = "aa131f23e45aaf3ea47b871577874cce99fc1e1e30d9c86f2e6f364491fd75c9";
const FIXTURE_SHA512: &str =
    "0WFRsFrPm0HlGLXvC+fHLBWwQAtqCgcmfjq5Zc4hSv1JQ3LaOHNsalNrvz/FaLZIFL9Yv5tjItE/W3zbaVqD+w==";

/// A scratch folder standing in for the home folder, with Misty's install root inside it. No
/// test here moves the process-wide `HOME`: other tests in the crate do, under locks of their own.
struct Scratch {
    dir: PathBuf,
    root: InstallRoot,
}

impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("misty-install-home-{}", uuid::Uuid::new_v4()));
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

fn write_program(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, "#!/bin/sh\necho 1.0.0\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn engines_and_node_install_into_mistys_folder() {
    let home = Scratch::new();
    let root = &home.root;
    let misty = home.dir.join(".misty");
    assert_eq!(root.engine_dir("gemini"), misty.join("engines/gemini"));
    assert_eq!(
        root.program_dirs("gemini"),
        vec![
            misty.join("engines/gemini/bin"),
            misty.join("engines/gemini/node_modules/.bin")
        ]
    );
    // Hermes Agent's launcher lives in its source checkout.
    assert_eq!(
        root.program_dirs("hermes")[2],
        misty.join("engines/hermes/hermes-agent/.hermes/bin")
    );
    assert_eq!(
        routes::script_target(root, "hermes"),
        misty.join("engines/hermes/hermes-agent")
    );
    assert_eq!(
        routes::script_target(root, "codex"),
        misty.join("engines/codex/bin")
    );
    assert_eq!(root.node_dir(), misty.join("runtime/node"));
    if !cfg!(windows) {
        assert_eq!(root.node_bin_dir(), misty.join("runtime/node/bin"));
    }
    // npm installs go into the engine's own folder, never globally.
    let args = routes::npm_prefix_args(&root.engine_dir("gemini"), "@google/gemini-cli");
    assert_eq!(
        &args[..3],
        [
            "install",
            "--prefix",
            &*misty.join("engines/gemini").to_string_lossy()
        ]
    );
    assert!(!args.iter().any(|arg| arg == "-g" || arg == "--global"));
    assert_eq!(args.last().unwrap(), "@google/gemini-cli@latest");
    // A downloaded build lands in the engine's `bin`.
    let claude = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    assert_eq!(
        maker_builds::program_path_in(root, "claude"),
        misty.join("engines/claude/bin").join(claude)
    );
    // The engine layer's own staging folders are never named after an engine.
    for engine in crate::engines::support::config::ENGINES {
        assert!(!engine.ends_with("-staging"), "{engine}");
    }
}

#[test]
fn makers_scripts_update_a_copy_they_put_on_the_computer_where_it_is() {
    // Codex and Antigravity come into Misty's folder as their builds; their scripts only update a
    // copy the person installed with them before, which stays where it is.
    let (program, args, env) = routes::script_argv("codex", None, false);
    assert!(program.ends_with("bash"), "{program}");
    assert_eq!(args[0], "-c");
    assert_eq!(
        args[1],
        "set -o pipefail; curl -fsSL https://chatgpt.com/codex/install.sh | bash"
    );
    assert!(!env
        .iter()
        .any(|(k, _)| k == "CODEX_INSTALL_DIR" || k == "HOME"));
    let (program, args, _) = routes::script_argv("agy", None, true);
    assert!(program.ends_with("\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"));
    assert!(!args.iter().any(|arg| arg.contains("Bypass")));
    assert_eq!(
        args.last().unwrap(),
        "irm https://antigravity.google/cli/install.ps1 | iex"
    );
}

#[test]
fn a_missing_engine_always_goes_into_mistys_folder() {
    let fresh = |engine: &str, windows: bool| routes::route(engine, engine, false, windows);
    assert_eq!(fresh("claude", false), Some(Route::MistyDownload));
    assert_eq!(fresh("claude", true), Some(Route::MistyDownload));
    assert_eq!(fresh("opencode", false), Some(Route::MistyDownload));
    assert_eq!(fresh("opencode", true), Some(Route::MistyNpm));
    assert_eq!(fresh("codex", false), Some(Route::MistyDownload));
    assert_eq!(fresh("codex", true), Some(Route::MistyDownload));
    assert_eq!(fresh("agy", false), Some(Route::MistyDownload));
    assert_eq!(fresh("agy", true), Some(Route::MistyDownload));
    for engine in ["gemini", "qwen", "kimi", "pi", "omp", "dsh"] {
        assert_eq!(fresh(engine, false), Some(Route::MistyNpm), "{engine}");
    }
    assert_eq!(fresh("hermes", false), Some(Route::MistyScript));
    assert_eq!(fresh("hermes", true), Some(Route::MistyScript));
    assert_eq!(fresh("grok", false), None);
}

#[test]
fn mistys_own_copy_updates_and_removes_the_way_misty_installed_it() {
    let home = Scratch::new();
    let root = &home.root;
    let npm_bin = root.program_dirs("gemini")[1].join("gemini");
    write_program(&npm_bin);
    let npm_bin = npm_bin.to_string_lossy().into_owned();
    assert!(routes::installed_by_misty_in(root, "gemini", &npm_bin));
    assert_eq!(
        routes::route_in(root, "gemini", &npm_bin, true, false),
        Some(Route::MistyNpm)
    );

    let claude = maker_builds::program_path_in(root, "claude");
    write_program(&claude);
    let claude = claude.to_string_lossy().into_owned();
    assert_eq!(
        routes::route_in(root, "claude", &claude, true, false),
        Some(Route::MistyDownload)
    );
    // Another engine's folder isn't this engine's.
    assert!(!routes::installed_by_misty_in(root, "codex", &claude));

    // A copy that was on the computer before is never removed.
    let elsewhere = home.dir.join(".local/bin/gemini");
    write_program(&elsewhere);
    let elsewhere = elsewhere.to_string_lossy().into_owned();
    assert!(!routes::installed_by_misty_in(root, "gemini", &elsewhere));
    assert!(routes::remove_in(root, &[], "gemini", &elsewhere).is_err());
    assert!(Path::new(&elsewhere).exists());

    routes::remove_in(root, &[], "gemini", &npm_bin).unwrap();
    assert!(!root.engine_dir("gemini").exists());
    assert!(root.engine_dir("claude").exists());
}

#[test]
fn engines_are_found_in_settings_then_the_computer_then_mistys_folder() {
    let home = Scratch::new();
    let name = format!("misty-find-{}", uuid::Uuid::new_v4().simple());
    let misty_dir = home.root.program_dirs("kimi")[0].clone();
    let mistys = misty_dir.join(&name);
    write_program(&mistys);
    let search = crate::engines::resolve::search_path_with(None, std::slice::from_ref(&misty_dir));
    // Only Misty's copy: it is found.
    let found = which::which_in(&name, Some(&search), &home.dir).expect("found");
    assert_eq!(std::fs::canonicalize(found).unwrap(), mistys);
    // A copy already on the computer, in a folder searched before Misty's, wins.
    let computer = home.dir.join("computer");
    write_program(&computer.join(&name));
    let both = std::env::join_paths([computer.clone(), misty_dir.clone()]).unwrap();
    assert_eq!(
        which::which_in(&name, Some(&both), &home.dir).unwrap(),
        computer.join(&name)
    );
    // The program path from Settings wins over everything.
    let chosen = home.dir.join("chosen").join(&name);
    write_program(&chosen);
    let found =
        crate::engines::resolve::find_cli_binary(&name, Some(&chosen.to_string_lossy())).unwrap();
    assert_eq!(found, chosen);
    // Misty's folders come after every folder the computer already searches.
    let search: Vec<PathBuf> = std::env::split_paths(&search).collect();
    let misty_at = search
        .iter()
        .position(|dir| *dir == misty_dir)
        .expect("Misty's folder is searched");
    assert_eq!(misty_at, search.len() - 1);
    let process_path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&process_path) {
        if let Some(at) = search.iter().position(|seen| *seen == dir) {
            assert!(
                at < misty_at,
                "{} comes after Misty's folder",
                dir.display()
            );
        }
    }
}

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

    // One changed byte fails both.
    std::fs::write(&file, b"Misty checks every download!\n").unwrap();
    assert!(!downloads::file_matches(&file, &sha256).unwrap());
    assert!(!downloads::file_matches(&file, &sha512).unwrap());
    // A hash of the other kind never passes.
    let mut hasher = Hasher::for_checksum(&sha256);
    hasher.update(FIXTURE);
    assert!(!hasher.matches(&sha512));

    // Malformed checksums aren't accepted at all.
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
    // A line that only starts with the name doesn't count.
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

#[test]
fn hermes_installs_its_checkout_into_mistys_folder_without_questions() {
    let into = Path::new("/home/me/.misty/engines/hermes/hermes-agent");
    let (_, args, env) = routes::script_argv("hermes", Some(into), false);
    assert_eq!(
        args[1],
        "set -o pipefail; curl -fsSL https://hermes-agent.nousresearch.com/install.sh \
         | bash -s -- --non-interactive --dir \"$MISTY_ENGINE_DIR\""
    );
    let get = |env: &[(String, String)], key: &str| {
        env.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    };
    assert_eq!(
        get(&env, "MISTY_ENGINE_DIR").as_deref(),
        Some("/home/me/.misty/engines/hermes/hermes-agent")
    );
    // Its shell profile lines and wrappers land in a home inside Misty's folder; its data stays
    // in the person's own Hermes folder.
    assert_eq!(
        get(&env, "HOME").as_deref(),
        Some("/home/me/.misty/engines/hermes/home")
    );
    // The person's own Hermes folder (other tests move the home it is read from).
    let data = get(&env, "HERMES_HOME").unwrap();
    assert!(!data.contains(".misty"), "{data}");
    let (_, args, env) = routes::script_argv("hermes", Some(into), true);
    assert!(get(&env, "HOME").is_none());
    assert_eq!(
        args.last().unwrap(),
        "& ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) \
         -NonInteractive -InstallDir $env:MISTY_ENGINE_DIR"
    );
    // Updating a copy that was on the computer before still answers nothing, and moves nothing.
    let (_, args, env) = routes::script_argv("hermes", None, false);
    assert!(get(&env, "HOME").is_none());
    assert!(
        args[1].ends_with("| bash -s -- --non-interactive"),
        "{}",
        args[1]
    );
    assert_eq!(
        routes::route("hermes", "/usr/bin/hermes", true, false),
        Some(Route::VendorScript)
    );
}

#[cfg(unix)]
#[test]
fn hermes_wrappers_for_mistys_checkout_are_mistys_and_go_with_remove() {
    let home = Scratch::new();
    let root = &home.root;
    let checkout = root.checkout_dir("hermes");
    write_program(&checkout.join(".hermes/bin/hermes"));
    let local_bin = home.dir.join(".local/bin");
    let wrapper = local_bin.join("hermes");
    write_program(&wrapper);
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nexec {}/.hermes/bin/hermes \"$@\"\n",
            checkout.display()
        ),
    )
    .unwrap();
    // The person's own Hermes, from another checkout, beside it.
    let theirs = local_bin.join("hermes-agent");
    std::fs::write(
        &theirs,
        "#!/bin/sh\nexec /home/me/.hermes/hermes-agent/.hermes/bin/hermes\n",
    )
    .unwrap();
    let wrapper_bin = wrapper.to_string_lossy().into_owned();
    assert!(routes::installed_by_misty_in(root, "hermes", &wrapper_bin));
    assert_eq!(
        routes::route_in(root, "hermes", &wrapper_bin, true, false),
        Some(Route::MistyScript)
    );
    assert!(!routes::installed_by_misty_in(
        root,
        "hermes",
        &theirs.to_string_lossy()
    ));
    // Another engine never reads a wrapper.
    assert!(!routes::installed_by_misty_in(root, "codex", &wrapper_bin));

    routes::remove_in(
        root,
        std::slice::from_ref(&local_bin),
        "hermes",
        &wrapper_bin,
    )
    .unwrap();
    assert!(!wrapper.exists());
    assert!(theirs.exists());
    assert!(!root.engine_dir("hermes").exists());
}
