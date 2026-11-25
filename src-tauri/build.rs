#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::{
    env,
    path::{Path, PathBuf},
};

fn main() {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    expose_public_app_configuration();
    build_workers(&manifest_dir);
    pack_agent_catalog(&manifest_dir);
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        for framework in [
            "AppKit",
            "AVFoundation",
            "Carbon",
            "CoreGraphics",
            "Security",
            "ApplicationServices",
            "CoreImage",
            "CoreMedia",
            "CoreVideo",
            "NaturalLanguage",
            "UserNotifications",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_common_controls_manifest();
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        tauri_build::try_build(sandbox_attributes().windows_attributes(windows))
            .expect("tauri build failed");
    } else {
        tauri_build::try_build(sandbox_attributes()).expect("tauri build failed");
    }
}

fn sandbox_attributes() -> tauri_build::Attributes {
    println!("cargo:rerun-if-changed=tauri-permissions");
    const APP_COMMANDS: &[&str] = include!("tauri-permissions/app_commands.in");
    tauri_build::Attributes::new()
        .capabilities_path_pattern("./tauri-permissions/capabilities/*.json")
        .app_manifest(
            tauri_build::AppManifest::new()
                .commands(APP_COMMANDS)
                .permissions_path_pattern("./tauri-permissions/*/*.toml"),
        )
}

fn embed_common_controls_manifest() {
    let compatibility =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo manifest directory"))
            .join("packaging")
            .join("windows")
            .join("compatibility.manifest");
    println!("cargo:rerun-if-changed={}", compatibility.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
    );
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        compatibility.display()
    );
}

fn expose_public_app_configuration() {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let app_folder = manifest_dir.parent().unwrap_or(Path::new("."));
    let app_env_path = app_folder.join(".env");
    if app_env_path.exists() {
        println!("cargo:rerun-if-changed={}", app_env_path.display());
    } else {
        println!("cargo:rerun-if-changed=build.rs");
    }
    let key = "MISTY_RELEASE_CHANNEL";
    println!("cargo:rerun-if-env-changed={key}");
    let value = env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| read_env_value(&app_env_path, key));
    if let Some(value) = value {
        println!("cargo:rustc-env={key}={value}");
    }
}

fn read_env_value(path: &Path, key: &str) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    contents.lines().find_map(|line| {
        let (candidate, raw) = line.split_once('=')?;
        if candidate.trim() != key {
            return None;
        }
        let value = raw
            .trim()
            .trim_matches(|character| character == '"' || character == '\'')
            .to_owned();
        (!value.is_empty()).then_some(value)
    })
}

const WORKERS: [(&str, &str); 4] = [
    ("document-processing", "documents/worker"),
    ("page-reader", "browser/page_text/worker"),
    ("agent-shell", "agents/shell/worker"),
    ("speech", "voice/speech_recognition/helper"),
];

fn place(built: &Path, placed: &Path) {
    let same = match (std::fs::read(built), std::fs::read(placed)) {
        (Ok(new), Ok(old)) => new == old,
        _ => false,
    };
    if !same {
        let _ = std::fs::remove_file(placed);
        std::fs::copy(built, placed).expect("place a helper program");
    }
}

fn build_workers(manifest_dir: &Path) {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let windows = target_os == "windows";
    let suffix = if windows { ".exe" } else { "" };
    let target = env::var("TARGET").expect("Cargo target");
    let profile = env::var("PROFILE").expect("Cargo profile");
    let placed_dir = manifest_dir.join("target").join("workers");
    std::fs::create_dir_all(&placed_dir).expect("make the helper programs' folder");
    let placed = |service: &str| placed_dir.join(format!("misty-{service}-{target}{suffix}"));
    let supported = matches!(target_os.as_str(), "macos" | "windows" | "linux");
    let cross_linux =
        target_os == "linux" && !env::var("HOST").unwrap_or_default().contains("linux");
    if !supported || cross_linux {
        for (service, _) in WORKERS {
            let path = placed(service);
            if !path.exists() {
                std::fs::write(&path, b"").expect("write a helper program's placeholder");
            }
        }
        return;
    }
    let root = manifest_dir.join("features");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    for shared in [
        root.join("browser").join("page_text"),
        root.join("voice").join("speech_recognition"),
    ] {
        for input in ["src", "Cargo.toml"] {
            println!("cargo:rerun-if-changed={}", shared.join(input).display());
        }
    }
    for (service, folder) in WORKERS {
        let directory = root.join(folder);
        for input in ["src", "Cargo.toml", "Cargo.lock"] {
            println!("cargo:rerun-if-changed={}", directory.join(input).display());
        }
        let mut command =
            std::process::Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
        command
            .current_dir(&directory)
            .args(["build", "--locked", "--target", &target]);
        let worker_target = out_dir
            .ancestors()
            .nth(3)
            .unwrap_or(&out_dir)
            .join("worker-targets")
            .join(service);
        command.env("CARGO_TARGET_DIR", &worker_target);
        command.env("CARGO_BUILD_BUILD_DIR", &worker_target);
        if profile == "release" {
            command.arg("--release");
        }
        if windows {
            let mut flags = env::var("CARGO_ENCODED_RUSTFLAGS").unwrap_or_default();
            if !flags.is_empty() {
                flags.push('\x1f');
            }
            flags.push_str("-Ctarget-feature=+crt-static");
            command.env("CARGO_ENCODED_RUSTFLAGS", flags);
        }
        let status = command.status().expect("could not build a helper program");
        assert!(status.success(), "could not build the {service} helper");
        let built = worker_target
            .join(&target)
            .join(&profile)
            .join(format!("misty-{service}{suffix}"));
        place(&built, &placed(service));
    }
}

fn pack_agent_catalog(manifest_dir: &Path) {
    let source = manifest_dir
        .join("resources")
        .join("agent-catalogs")
        .join("agency-agents");
    println!("cargo:rerun-if-changed={}", source.display());
    let mut files = Vec::new();
    let mut folders = vec![source.clone()];
    while let Some(folder) = folders.pop() {
        for entry in std::fs::read_dir(&folder).expect("read the persona catalog") {
            let path = entry.expect("read the persona catalog").path();
            if path.is_dir() {
                folders.push(path);
            } else if path.file_name().is_some_and(|name| name != ".DS_Store") {
                files.push(path);
            }
        }
    }
    files.sort();
    let mut archive = tar::Builder::new(Vec::new());
    for path in &files {
        let name = path
            .strip_prefix(&source)
            .expect("a catalog file inside the catalog")
            .to_str()
            .expect("a catalog file's name is text")
            .replace('\\', "/");
        let bytes = std::fs::read(path).expect("read a catalog file");
        let mut header = tar::Header::new_ustar();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_mtime(0);
        header.set_entry_type(tar::EntryType::Regular);
        archive
            .append_data(&mut header, &name, bytes.as_slice())
            .expect("pack a catalog file");
    }
    let packed = archive.into_inner().expect("pack the persona catalog");
    let compressed = zstd::bulk::compress(&packed, 19).expect("compress the persona catalog");
    let folder = manifest_dir
        .join("target")
        .join("bundled")
        .join("agent-catalogs");
    std::fs::create_dir_all(&folder).expect("make the persona catalog's folder");
    let archive_path = folder.join("agency-agents.tar.zst");
    if std::fs::read(&archive_path).ok().as_deref() != Some(compressed.as_slice()) {
        std::fs::write(&archive_path, &compressed).expect("write the persona catalog");
    }
    println!(
        "cargo:rustc-env=MISTY_AGENT_CATALOG={}",
        archive_path.display()
    );
}
