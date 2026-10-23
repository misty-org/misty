//! Repository-owned TypeScript tasks under cli/tasks.

use crate::{process::CommandSpec, workspace::Workspace};
use anyhow::{bail, Result};
use std::path::PathBuf;

// Executable tasks only; imported helpers and test fixtures are not commands.
const TASKS: &[&str] = &[
    "run-signed-desktop",
    "run-tool",
    "tauri",
    "release/setup-keys",
];

/// Tooling that uses Vite/Node APIs stays in TypeScript under cli/tasks.
/// Only repository-owned tasks may be selected; arguments remain separate OS arguments.
pub fn run(workspace: &Workspace, name: &str, arguments: &[String]) -> Result<()> {
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
        bail!("Use a task name relative to cli/tasks, such as release/setup-keys");
    }
    let path = root.join(format!("{name}.ts")).canonicalize()?;
    if !path.starts_with(root) || !path.is_file() {
        bail!("Task must be a file inside cli/tasks");
    }
    Ok(path)
}

pub fn list(workspace: &Workspace) -> Result<()> {
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
    fn every_listed_task_exists() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tasks");
        for name in TASKS {
            assert!(
                root.join(format!("{name}.ts")).is_file(),
                "{name} is listed but missing"
            );
        }
    }
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
