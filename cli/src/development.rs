use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};
use anyhow::{bail, Result};
use std::path::PathBuf;

pub fn setup(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    let version = CommandSpec::new("node")
        .args(["--version"])
        .capture(&workspace.misty)?;
    let version = version.trim().trim_start_matches('v');
    let mut parts = version
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok());
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    if major < 24 || (major == 24 && minor < 12) {
        bail!("Misty requires Node.js 24.12 or newer; found {version}");
    }
    CommandSpec::new(npm()).args(["ci"]).run(&workspace.misty)
}

// Executable tasks only; imported helpers and test fixtures are not commands.
const TASKS: &[&str] = &[
    "build-native-services",
    "run-signed-desktop",
    "run-tool",
    "tauri",
    "workspace-pane-lifecycle",
    "release/beta",
    "release/collect-macos",
    "release/finalize-draft",
    "release/prepare-manifest",
    "release/promote-beta",
    "release/setup-keys",
    "release/sign-dmg",
];

/// Tooling that uses Vite/Node APIs stays in TypeScript under cli/tasks.
/// Only repository-owned tasks may be selected; arguments remain separate OS arguments.
pub fn task(workspace: &Workspace, name: &str, arguments: &[String]) -> Result<()> {
    workspace.validate()?;
    let root = workspace.cli.join("tasks").canonicalize()?;
    let path = task_path(&root, name)?;
    CommandSpec::new("node")
        .arg(path.as_os_str())
        .args(arguments.iter().cloned())
        .run(&workspace.misty)
}

fn task_path(root: &std::path::Path, name: &str) -> Result<PathBuf> {
    if !TASKS.contains(&name)
        || name.is_empty()
        || name.starts_with('/')
        || name.contains('\\')
        || name
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        bail!("Use a task name relative to cli/tasks, such as release/prepare-manifest");
    }
    let path = root.join(format!("{name}.ts")).canonicalize()?;
    if !path.starts_with(root) || !path.is_file() {
        bail!("Task must be a file inside cli/tasks");
    }
    Ok(path)
}

pub fn tasks(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    for name in TASKS {
        println!("{name}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_repo_tasks_can_run() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("tauri.ts"), "").unwrap();
        assert_eq!(task_path(&root, "tauri").unwrap(), root.join("tauri.ts"));
        for name in [
            "../hello",
            "/hello",
            "a/../../hello",
            "a\\hello",
            "",
            "app-env",
            "tooling",
            "dev-build.test",
        ] {
            assert!(task_path(&root, name).is_err());
        }
    }
}
