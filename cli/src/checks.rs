use std::{fs, path::Path};

use anyhow::{bail, Result};
use walkdir::WalkDir;

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn release(workspace: &Workspace) -> Result<()> {
    CommandSpec::new("bash")
        .args([".githooks/checks.sh", "all"])
        .run(&workspace.misty)
}

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
        .run(&workspace.misty)?;
    // Kiri's core tests need no Tauri, matching the kiri-crate git hook step.
    CommandSpec::new("cargo")
        .args([
            "fmt",
            "--manifest-path",
            "kiri/Cargo.toml",
            "--all",
            "--",
            "--check",
        ])
        .run(&workspace.misty)?;
    CommandSpec::new("cargo")
        .args([
            "test",
            "--locked",
            "--no-default-features",
            "--manifest-path",
            "kiri/Cargo.toml",
        ])
        .run(&workspace.misty)?;
    CommandSpec::new(npm())
        .args(["run", "test:scripts"])
        .run(&workspace.misty)?;
    let mut manifests = vec![workspace
        .misty
        .join("src-tauri/crates/browser-sync/Cargo.toml")];
    for entry in std::fs::read_dir(workspace.misty.join("src-tauri/services"))? {
        let manifest = entry?.path().join("Cargo.toml");
        if manifest.is_file() {
            manifests.push(manifest);
        }
    }
    manifests.sort();
    for manifest in manifests {
        CommandSpec::new("cargo")
            .args(["test", "--locked", "--manifest-path"])
            .arg(manifest.as_os_str())
            .run(&workspace.misty)?;
    }
    Ok(())
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
    go_file_sizes(&workspace.server)?;

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
    CommandSpec::new("bash")
        .arg("scripts/test-billing-contract.sh")
        .run(&workspace.server)?;

    let worker = workspace.server.join("apps/journal-collab");
    CommandSpec::new(npm()).args(["ci"]).run(&worker)?;
    for script in ["typecheck", "test", "test:runtime", "audit:production"] {
        CommandSpec::new(npm()).args(["run", script]).run(&worker)?;
    }
    let runtime = workspace.server.join("apps/agent-runtime");
    CommandSpec::new(npm()).args(["ci"]).run(&runtime)?;
    for script in ["typecheck", "test", "build"] {
        CommandSpec::new(npm())
            .args(["run", script])
            .run(&runtime)?;
    }
    Ok(())
}

pub fn website(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    for script in ["typecheck", "lint", "test", "build"] {
        CommandSpec::new(npm())
            .args(["run", script])
            .run(&workspace.website)?;
    }
    Ok(())
}

pub fn features(workspace: &Workspace) -> Result<()> {
    if !workspace.features.is_dir() {
        bail!("features directory is missing");
    }
    CommandSpec::new(npm())
        .args(["test", "--", "src/features"])
        .run(&workspace.misty)
}

pub fn cli(workspace: &Workspace) -> Result<()> {
    workspace.validate()?;
    CommandSpec::new("cargo")
        .args(["fmt", "--all", "--", "--check"])
        .run(&workspace.cli)?;
    CommandSpec::new("cargo")
        .args(["clippy", "--all-targets", "--", "-D", "warnings"])
        .run(&workspace.cli)?;
    CommandSpec::new("cargo")
        .args(["test", "--all-targets", "--locked"])
        .run(&workspace.cli)
}

const GO_FILE_HARD_MAX: usize = 500;
const GO_FILE_PREFERRED_MAX: usize = 300;

/// Fails when a handwritten Go file passes the hard line limit and reports files over the
/// preferred limit. Generated files and vendored or dependency folders are skipped.
pub fn go_file_sizes(server: &Path) -> Result<()> {
    let report = measure_go_files(server)?;
    for line in &report.lines {
        println!("{line}");
    }
    if report.lines.is_empty() {
        println!("All handwritten Go files are at most {GO_FILE_PREFERRED_MAX} lines.");
    }
    if report.failed {
        bail!("Go files exceed {GO_FILE_HARD_MAX} lines");
    }
    Ok(())
}

struct GoFileReport {
    lines: Vec<String>,
    failed: bool,
}

fn measure_go_files(server: &Path) -> Result<GoFileReport> {
    let mut report = GoFileReport {
        lines: Vec::new(),
        failed: false,
    };
    let skipped = |name: &str| matches!(name, ".git" | "vendor" | "node_modules");
    let mut files: Vec<_> = WalkDir::new(server)
        .into_iter()
        .filter_entry(|entry| !skipped(&entry.file_name().to_string_lossy()))
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "go"))
        .map(|entry| entry.into_path())
        .collect();
    files.sort();
    for path in files {
        let text = fs::read_to_string(&path)?;
        let generated = text
            .lines()
            .take(10)
            .any(|line| line.starts_with("// Code generated ") && line.ends_with(" DO NOT EDIT."));
        if generated {
            continue;
        }
        let count = text.lines().count();
        let name = path.strip_prefix(server).unwrap_or(&path).display();
        if count > GO_FILE_HARD_MAX {
            report.lines.push(format!(
                "ERROR {count:>4} lines  {name} (hard maximum: {GO_FILE_HARD_MAX})"
            ));
            report.failed = true;
        } else if count > GO_FILE_PREFERRED_MAX {
            report.lines.push(format!(
                "REPORT {count:>3} lines  {name} (preferred maximum: {GO_FILE_PREFERRED_MAX})"
            ));
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_lines(path: &Path, count: usize, header: &str) {
        let body = "x
"
        .repeat(count);
        fs::write(path, format!("{header}{body}")).unwrap();
    }

    #[test]
    fn go_file_sizes_flags_oversized_handwritten_files_only() {
        let dir = tempfile::tempdir().unwrap();
        write_lines(&dir.path().join("small.go"), 10, "");
        write_lines(&dir.path().join("medium.go"), 350, "");
        write_lines(&dir.path().join("large.go"), 600, "");
        write_lines(
            &dir.path().join("generated.go"),
            600,
            "// Code generated by tool. DO NOT EDIT.
",
        );
        fs::create_dir(dir.path().join("vendor")).unwrap();
        write_lines(&dir.path().join("vendor/skipped.go"), 600, "");

        let report = measure_go_files(dir.path()).unwrap();

        assert!(report.failed);
        assert_eq!(report.lines.len(), 2);
        assert!(report.lines[0].contains("large.go"));
        assert!(report.lines[1].contains("medium.go"));
    }
}
