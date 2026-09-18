use std::{
    env,
    path::{Path, PathBuf},
};

fn main() {
    expose_public_app_configuration();
    require_desktop_app_signing_key_for_release();
    build_ios_browser_adapter();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // Objective-C availability checks need Clang's runtime when targeting
        // older macOS versions. Rust links with -nodefaultlibs, so the driver
        // does not add it automatically (debug builds on newer SDKs can hide this).
        let runtime = cc::Build::new()
            .get_compiler()
            .to_command()
            .arg("--print-runtime-dir")
            .output()
            .expect("could not locate the macOS Clang runtime");
        assert!(runtime.status.success(), "could not locate the macOS Clang runtime");
        let runtime_dir = String::from_utf8(runtime.stdout).expect("invalid Clang runtime path");
        println!("cargo:rustc-link-search=native={}", runtime_dir.trim());
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
        println!("cargo:rerun-if-changed=native/macos/MistyContext.m");
        println!("cargo:rerun-if-changed=native/macos/MistyFolderBookmarks.m");
        cc::Build::new()
            .file("native/macos/MistyContext.m")
            .file("native/macos/MistyFolderBookmarks.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("misty_context");
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        for framework in ["AppKit", "Carbon", "CoreGraphics", "Security"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build();
}

fn build_ios_browser_adapter() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }

    let source = PathBuf::from("native/ios/MistyBrowserAdapter.mm");
    println!("cargo:rerun-if-changed={}", source.display());
    cc::Build::new()
        .cpp(true)
        .file(source)
        .flag("-fobjc-arc")
        .compile("misty_ios_browser_adapter");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=UIKit");
    println!("cargo:rustc-link-lib=framework=WebKit");
}

fn expose_public_app_configuration() {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let app_env_path = manifest_dir.parent().unwrap_or(Path::new(".")).join(".env");
    println!("cargo:rerun-if-changed={}", app_env_path.display());
    for key in [
        "POSTHOG_PROJECT_TOKEN",
        "POSTHOG_HOST",
        "MISTY_RELEASE_CHANNEL",
        "MISTY_DEVICE_RELAY_URL",
        "MISTY_DEVICE_TICKET_PUBLIC_KEYS",
        "MISTY_OFFICIAL_APP_SIGNING_KEY_ID",
        "MISTY_OFFICIAL_APP_PUBLIC_KEY",
    ] {
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

fn require_desktop_app_signing_key_for_release() {
    let profile = env::var("PROFILE").unwrap_or_default();
    let target = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if profile != "release" || matches!(target.as_str(), "ios" | "android") {
        return;
    }
    for key in [
        "MISTY_OFFICIAL_APP_SIGNING_KEY_ID",
        "MISTY_OFFICIAL_APP_PUBLIC_KEY",
    ] {
        if env::var(key)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR")?);
                read_env_value(&root.parent()?.join(".env"), key)
            })
            .is_none()
        {
            panic!("{key} is required for a desktop release build");
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
