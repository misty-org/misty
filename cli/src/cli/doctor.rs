//! `misty doctor release`: release tools, Rust targets and checkout state.

use super::*;

pub(super) fn doctor(settings: &Settings) -> Result<()> {
    crate::workspace::Workspace::validate(&settings.workspace)?;
    let mut commands = vec![
        "node", "npm", "cargo", "rustc", "rustup", "go", "docker", "gh",
    ];
    if cfg!(target_os = "macos") {
        commands.extend(["xcodebuild", "lipo", "codesign", "xcrun", "spctl"]);
    } else if cfg!(windows) {
        commands.extend(["powershell"]);
    }
    let mut missing = Vec::new();
    for command in commands {
        let found = crate::process::command_exists(command);
        println!("{command:<18} {}", if found { "ready" } else { "missing" });
        if !found {
            missing.push(command);
        }
    }
    if !missing.is_empty() {
        anyhow::bail!("missing required commands: {}", missing.join(", "));
    }
    crate::process::CommandSpec::new("gh")
        .args(["auth", "status"])
        .run(&settings.workspace.root)?;
    verify_rust_targets(settings)?;
    crate::process::CommandSpec::new(crate::process::npm())
        .args(["exec", "tauri", "--", "--version"])
        .run(&settings.workspace.misty)?;
    crate::process::CommandSpec::new("cargo")
        .args(["cyclonedx", "--version"])
        .run(&settings.workspace.misty)?;
    release::check(&settings.workspace)?;
    report_repository_status(settings)?;
    println!("workspace  {}", settings.workspace.root.display());
    Ok(())
}

pub(super) fn verify_rust_targets(settings: &Settings) -> Result<()> {
    let installed = crate::process::CommandSpec::new("rustup")
        .args(["target", "list", "--installed"])
        .capture(&settings.workspace.cli)?;
    let required: &[&str] = if cfg!(target_os = "macos") {
        &["aarch64-apple-darwin", "x86_64-apple-darwin"]
    } else if cfg!(windows) {
        &["x86_64-pc-windows-msvc"]
    } else {
        &[]
    };
    let missing = required
        .iter()
        .filter(|target| !installed.lines().any(|line| line.trim() == **target))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        anyhow::bail!(
            "missing Rust release targets: {}; install them with rustup target add",
            missing.join(", ")
        );
    }
    println!("Rust targets       ready");
    Ok(())
}

pub(super) fn report_repository_status(settings: &Settings) -> Result<()> {
    for (name, repository) in [
        ("misty", &settings.workspace.misty),
        ("misty-website", &settings.workspace.website),
    ] {
        if !repository.is_dir() {
            println!("{name:<18} optional checkout absent");
            continue;
        }
        let status = crate::process::CommandSpec::new("git")
            .args(["status", "--porcelain"])
            .capture(repository)?;
        println!(
            "{name:<18} {}",
            if status.trim().is_empty() {
                "clean"
            } else {
                "has local changes"
            }
        );
    }
    Ok(())
}
