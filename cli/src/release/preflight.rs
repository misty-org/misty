use std::{collections::BTreeMap, env, path::Path};

use anyhow::{bail, Result};

use crate::{process::CommandSpec, workspace::Workspace};

use super::config;

pub(super) fn check(workspace: &Workspace) -> Result<()> {
    let mut required = vec![
        "MISTY_RELEASE_API_URL",
        "MISTY_RELEASE_WEB_URL",
        "TAURI_UPDATER_PUBLIC_KEY",
        "TAURI_CSP_CONNECT_SOURCES",
        "TAURI_CSP_IMAGE_SOURCES",
        "TAURI_SIGNING_PRIVATE_KEY",
    ];
    if cfg!(target_os = "macos") {
        required.extend(["APPLE_SIGNING_IDENTITY", "MISTY_NOTARY_KEYCHAIN_PROFILE"]);
    } else if cfg!(windows) {
        required.extend(["WINDOWS_CERTIFICATE_THUMBPRINT", "WINDOWS_TIMESTAMP_URL"]);
    }
    let values: BTreeMap<_, _> = env::vars().collect();
    let missing = missing_inputs(&required, &values);
    if !missing.is_empty() {
        bail!("Release configuration is incomplete: {}. Set these once in cli/.env/release.env (mode 600); values are never printed.", missing.join(", "));
    }
    config::build()?;
    config::public_environment()?;
    let key = &values["TAURI_SIGNING_PRIVATE_KEY"];
    // Tauri accepts either a key file or inline key material.
    if (key.starts_with('/')
        || key.starts_with("./")
        || key.starts_with("../")
        || key.contains('\\'))
        && !Path::new(key).is_file()
    {
        bail!("TAURI_SIGNING_PRIVATE_KEY points to a missing file");
    }
    CommandSpec::new("gh")
        .args(["auth", "status"])
        .capture(&workspace.misty)?;
    CommandSpec::new("cargo")
        .args(["cyclonedx", "--version"])
        .capture(&workspace.misty)?;
    let targets = CommandSpec::new("rustup")
        .args(["target", "list", "--installed"])
        .capture(&workspace.misty)?;
    let required_targets: &[&str] = if cfg!(target_os = "macos") {
        &["aarch64-apple-darwin", "x86_64-apple-darwin"]
    } else if cfg!(windows) {
        &["x86_64-pc-windows-msvc"]
    } else {
        bail!("Desktop releases must be built on macOS or Windows");
    };
    let missing = required_targets
        .iter()
        .filter(|target| !targets.lines().any(|line| line.trim() == **target))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!(
            "Install release targets first: rustup target add {}",
            missing.join(" ")
        );
    }
    if cfg!(target_os = "macos") {
        let identity = &values["APPLE_SIGNING_IDENTITY"];
        if identity == "-" {
            bail!("Release signing requires a Developer ID identity, not ad-hoc signing");
        }
        let identities = CommandSpec::new("security")
            .args(["find-identity", "-v", "-p", "codesigning"])
            .capture(&workspace.misty)?;
        if !identities
            .lines()
            .any(|line| line.contains(identity) && line.contains("Developer ID Application"))
        {
            bail!("APPLE_SIGNING_IDENTITY must match an installed Developer ID Application certificate");
        }
        CommandSpec::new("xcrun")
            .args(["--find", "notarytool"])
            .capture(&workspace.misty)?;
    }
    println!("Local release inputs and build tools are ready. Notarization credentials are checked by Apple during submission.");
    Ok(())
}

fn missing_inputs<'a>(required: &[&'a str], values: &BTreeMap<String, String>) -> Vec<&'a str> {
    required
        .iter()
        .copied()
        .filter(|name| {
            values
                .get(*name)
                .is_none_or(|value| value.trim().is_empty())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_all_missing_names_without_secret_values() {
        let values = BTreeMap::from([
            ("KEY".into(), "secret-value".into()),
            ("EMPTY".into(), " ".into()),
        ]);
        assert_eq!(
            missing_inputs(&["KEY", "EMPTY", "URL"], &values),
            vec!["EMPTY", "URL"]
        );
    }
}
