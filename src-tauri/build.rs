use std::{
    env,
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
};

fn main() {
    expose_public_telemetry_configuration();
    println!("cargo:rerun-if-env-changed=MISTY_SERVICE_GO_LIB_DIR");
    if std::env::var_os("CARGO_FEATURE_EMBEDDED_STORAGE_GO").is_some() {
        let lib_name = "misty_service";
        let lib_dir = std::env::var_os("MISTY_SERVICE_GO_LIB_DIR")
            .map(|raw| resolve_go_archive_dir(&raw))
            .unwrap_or_else(default_go_archive_dir);
        let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        let library_path = match target_os.as_str() {
            "android" => lib_dir.join(format!("lib{lib_name}.so")),
            "windows" => lib_dir.join(format!("{lib_name}.dll")),
            _ => lib_dir.join(format!("lib{lib_name}.a")),
        };
        println!("cargo:rustc-link-search=native={}", lib_dir.display());
        println!("cargo:rerun-if-changed={}", library_path.display());
        if !library_path.exists() {
            println!(
                "cargo:warning=embedded Misty storage library was not found at {}",
                library_path.display()
            );
        }
        if target_os == "android" {
            println!("cargo:rustc-link-lib=dylib={lib_name}");
        } else if target_os != "windows" {
            println!("cargo:rustc-link-lib=static={lib_name}");
        }
        if std::env::var("CARGO_CFG_TARGET_VENDOR").as_deref() == Ok("apple") {
            println!("cargo:rustc-link-lib=resolv");
            if let Some(runtime_dir) = apple_clang_runtime_dir() {
                println!("cargo:rustc-link-search=native={}", runtime_dir.display());
            }
        }
        if target_os == "android" {
            println!("cargo:rustc-link-lib=log");
            println!("cargo:rustc-link-lib=android");
            println!("cargo:rustc-link-lib=dl");
        }
    }
    tauri_build::build();
}

fn expose_public_telemetry_configuration() {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let analytics_path = manifest_dir
        .parent()
        .unwrap_or(Path::new("."))
        .join(".env.analytics");
    println!("cargo:rerun-if-changed={}", analytics_path.display());
    for key in [
        "POSTHOG_PROJECT_TOKEN",
        "POSTHOG_HOST",
        "MISTY_RELEASE_CHANNEL",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        let value = env::var(key)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| read_env_value(&analytics_path, key));
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
        .join("misty-service")
        .join(default_go_archive_target())
}

fn default_go_archive_target() -> &'static str {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_abi = env::var("CARGO_CFG_TARGET_ABI").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    match (
        target_os.as_str(),
        target_abi.as_str(),
        target_arch.as_str(),
    ) {
        ("ios", "sim", "aarch64") => "ios-simulator-arm64",
        ("ios", "sim", "x86_64") => "ios-simulator-amd64",
        ("ios", _, "aarch64") => "ios-arm64",
        ("android", _, "aarch64") => "android-arm64",
        ("android", _, "arm") => "android-armv7",
        ("android", _, "x86") => "android-x86",
        ("android", _, "x86_64") => "android-x86_64",
        ("macos", _, _) => "host",
        _ => "host",
    }
}

fn apple_clang_runtime_dir() -> Option<PathBuf> {
    let sdk = match (
        env::var("CARGO_CFG_TARGET_OS").ok()?.as_str(),
        env::var("CARGO_CFG_TARGET_ABI")
            .unwrap_or_default()
            .as_str(),
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
