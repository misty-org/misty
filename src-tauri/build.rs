// A build script runs at compile time, on the source tree, so the app's file gate doesn't apply.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::{
    env,
    path::{Path, PathBuf},
};

fn main() {
    expose_public_app_configuration();
    build_builtin_workers();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
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
            "Vision",
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

/// The sandbox's actions, grants and permissions. Listing the app's
/// commands makes Tauri refuse any command no capability allows, for every window.
fn sandbox_attributes() -> tauri_build::Attributes {
    const APP_COMMANDS: &[&str] = include!("tauri-permissions/app_commands.in");
    tauri_build::Attributes::new()
        .capabilities_path_pattern("./tauri-permissions/capabilities/*.json")
        .app_manifest(
            tauri_build::AppManifest::new()
                .commands(APP_COMMANDS)
                .permissions_path_pattern("./tauri-permissions/*/*.toml"),
        )
}

/// Tauri's Windows manifest only asks for Common Controls 6, and only the app
/// gets it. Every binary that links this crate imports comctl32 v6 entry
/// points, so unit tests and examples need it too or they fail to start with
/// STATUS_ENTRYPOINT_NOT_FOUND. The linker embeds it everywhere instead,
/// with the Windows versions Misty supports (`packaging/windows/compatibility.manifest`).
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
    let app_env_path = manifest_dir.parent().unwrap_or(Path::new(".")).join(".env");
    println!("cargo:rerun-if-changed={}", app_env_path.display());
    for key in ["MISTY_RELEASE_CHANNEL"] {
        println!("cargo:rerun-if-env-changed={key}");
        let value = env::var(key)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| read_env_value(&app_env_path, key));
        if let Some(value) = value {
            println!("cargo:rustc-env={key}={value}");
        }
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

/// Build helpers for the same target and profile as Misty, then embed their
/// bytes. Keep helpers inside this build's OUT_DIR so neither the parent nor
/// another desktop profile competes for the same worker build directory.
fn build_builtin_workers() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" && target_os != "windows" {
        return;
    }
    let windows = target_os == "windows";
    let root = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("features");
    let target = env::var("TARGET").expect("Cargo target");
    let profile = env::var("PROFILE").expect("Cargo profile");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    let mut source = String::from("match (service, protocol) {\n");
    // The page reader's code is in a crate the agent runtime shares, outside its worker's folder.
    let shared = root.join("browser").join("page_text");
    for input in ["src", "Cargo.toml"] {
        println!("cargo:rerun-if-changed={}", shared.join(input).display());
    }
    for (service, protocol, folder) in [
        ("document-processing", 6, "documents/worker"),
        ("page-reader", 1, "browser/page_text/worker"),
        ("agent-shell", 1, "agents/shell/worker"),
    ] {
        let directory = root.join(folder);
        for input in ["src", "Cargo.toml", "Cargo.lock"] {
            println!("cargo:rerun-if-changed={}", directory.join(input).display());
        }
        let mut command =
            std::process::Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
        command
            .current_dir(&directory)
            .args(["build", "--locked", "--target", &target]);
        let worker_target = out_dir.join("worker-targets").join(service);
        command.env("CARGO_TARGET_DIR", &worker_target);
        // Do not inherit the desktop's intermediate directory: a nested Cargo
        // build would wait on the lock held by its own parent build.
        command.env("CARGO_BUILD_BUILD_DIR", &worker_target);
        if profile == "release" {
            command.arg("--release");
        }
        // The confined Windows helper cannot load the Visual C++ runtime from
        // outside its folder, so it carries the runtime itself.
        if windows {
            let mut flags = env::var("CARGO_ENCODED_RUSTFLAGS").unwrap_or_default();
            if !flags.is_empty() {
                flags.push('');
            }
            flags.push_str("-Ctarget-feature=+crt-static");
            command.env("CARGO_ENCODED_RUSTFLAGS", flags);
        }
        let status = command.status().expect("could not build bundled worker");
        assert!(status.success(), "could not build bundled {service} worker");
        let binary = worker_target.join(&target).join(&profile).join(format!(
            "misty-{service}{}",
            if windows { ".exe" } else { "" }
        ));
        source.push_str(&format!(
            "({service:?}, {protocol}) => Ok(include_bytes!({:?})),\n",
            binary
        ));
    }
    source.push_str("_ => Err(\"Unknown built-in worker protocol.\".into()),\n}");
    std::fs::write(out_dir.join("builtin_workers.rs"), source).expect("write bundled worker map");
}
