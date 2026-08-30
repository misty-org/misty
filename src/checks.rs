use anyhow::{bail, Result};

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn app(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    CommandSpec::new(npm())
        .args(["run", "check"])
        .run(&workspace.misty)?;
    CommandSpec::new("cargo")
        .args([
            "fmt",
            "--manifest-path",
            "src-tauri/Cargo.toml",
            "--all",
            "--",
            "--check",
        ])
        .run(&workspace.misty)?;
    CommandSpec::new("cargo")
        .args([
            "clippy",
            "--manifest-path",
            "src-tauri/Cargo.toml",
            "--all-targets",
        ])
        .run(&workspace.misty)?;
    CommandSpec::new("cargo")
        .args([
            "test",
            "--manifest-path",
            "src-tauri/Cargo.toml",
            "--locked",
        ])
        .run(&workspace.misty)
}

pub fn server(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    let formatted = CommandSpec::new("gofmt")
        .args(["-l", "."])
        .capture(&workspace.server)?;
    if !formatted.trim().is_empty() {
        bail!("Go formatting is required:\n{}", formatted.trim());
    }
    CommandSpec::new("go")
        .args(["vet", "./..."])
        .run(&workspace.server)?;

    #[cfg(windows)]
    CommandSpec::new("go")
        .args(["test", "-p", "1", "./...", "-count=1"])
        .run(&workspace.server)?;
    #[cfg(not(windows))]
    CommandSpec::new("./test.sh").run(&workspace.server)?;

    let container_contract = workspace.server.join("scripts/check-container-contract.sh");
    if container_contract.is_file() {
        CommandSpec::new("./scripts/check-container-contract.sh").run(&workspace.server)?;
    }

    let worker = workspace.server.join("cloudflare/journal-collab");
    CommandSpec::new(npm()).args(["ci"]).run(&worker)?;
    for script in ["typecheck", "test", "test:runtime", "audit:production"] {
        CommandSpec::new(npm()).args(["run", script]).run(&worker)?;
    }
    let runtime = workspace.server.join("agent-runtime");
    CommandSpec::new(npm()).args(["ci"]).run(&runtime)?;
    for script in ["typecheck", "test", "build"] {
        CommandSpec::new(npm())
            .args(["run", script])
            .run(&runtime)?;
    }
    Ok(())
}
