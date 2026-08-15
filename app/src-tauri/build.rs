use std::{
    env,
    path::{Path, PathBuf},
};

fn main() {
    expose_public_telemetry_configuration();
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
        "MISTY_CONNECTED_DEVICES_ENABLED",
        "MISTY_DEVICE_RELAY_URL",
        "MISTY_DEVICE_TICKET_PUBLIC_KEYS",
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
