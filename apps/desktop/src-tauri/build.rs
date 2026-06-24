use std::{
    env,
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    println!("cargo:rerun-if-env-changed=MISTY_PROXY_GO_LIB_DIR");
    println!("cargo:rerun-if-env-changed=MISTY_PROXY_GO_LIB_NAME");
    if std::env::var_os("CARGO_FEATURE_EMBEDDED_PROXY_GO").is_some() {
        let lib_name =
            std::env::var("MISTY_PROXY_GO_LIB_NAME").unwrap_or_else(|_| "misty_proxy".to_owned());
        let lib_dir = std::env::var_os("MISTY_PROXY_GO_LIB_DIR")
            .map(|raw| resolve_go_archive_dir(&raw))
            .unwrap_or_else(default_go_archive_dir);
        let archive_path = lib_dir.join(format!("lib{lib_name}.a"));
        println!("cargo:rustc-link-search=native={}", lib_dir.display());
        println!("cargo:rerun-if-changed={}", archive_path.display());
        if !archive_path.exists() {
            println!(
                "cargo:warning=embedded misty-proxy archive was not found at {}",
                archive_path.display()
            );
        }
        println!("cargo:rustc-link-lib=static={lib_name}");
        if std::env::var("CARGO_CFG_TARGET_VENDOR").as_deref() == Ok("apple") {
            println!("cargo:rustc-link-lib=resolv");
            if let Some(runtime_dir) = apple_clang_runtime_dir() {
                println!("cargo:rustc-link-search=native={}", runtime_dir.display());
            }
        }
    }
    tauri_build::build();
}

fn resolve_go_archive_dir(raw: &OsStr) -> PathBuf {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return path;
    }

    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let app_dir = manifest_dir.parent().unwrap_or(Path::new("."));
    let cwd = env::current_dir().unwrap_or_else(|_| manifest_dir.clone());

    [
        app_dir.join(&path),
        manifest_dir.join(&path),
        cwd.join(&path),
    ]
    .into_iter()
    .find(|candidate| candidate.exists())
    .unwrap_or_else(|| app_dir.join(path))
}

fn default_go_archive_dir() -> PathBuf {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    manifest_dir
        .join("target")
        .join("misty-proxy")
        .join(default_go_archive_target())
}

fn default_go_archive_target() -> &'static str {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_abi = env::var("CARGO_CFG_TARGET_ABI").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    match (target_os.as_str(), target_abi.as_str(), target_arch.as_str()) {
        ("ios", "sim", "aarch64") => "ios-simulator-arm64",
        ("ios", "sim", "x86_64") => "ios-simulator-amd64",
        ("ios", _, "aarch64") => "ios-arm64",
        ("macos", _, _) => "host",
        _ => "host",
    }
}

fn apple_clang_runtime_dir() -> Option<PathBuf> {
    let sdk = match (
        env::var("CARGO_CFG_TARGET_OS").ok()?.as_str(),
        env::var("CARGO_CFG_TARGET_ABI").unwrap_or_default().as_str(),
    ) {
        ("ios", "sim") => "iphonesimulator",
        ("ios", _) => "iphoneos",
        ("macos", _) => "macosx",
        _ => return None,
    };

    let clang = command_stdout(Command::new("xcrun").args(["--sdk", sdk, "--find", "clang"]))?;
    let runtime = command_stdout(Command::new(clang).arg("-print-libgcc-file-name"))?;
    PathBuf::from(runtime).parent().map(Path::to_path_buf)
}

fn command_stdout(command: &mut Command) -> Option<String> {
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    Some(stdout.trim().to_owned()).filter(|value| !value.is_empty())
}
