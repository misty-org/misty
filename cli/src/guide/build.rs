//! "Build the app": a test build for this computer, or the guided release.

use anyhow::{bail, Result};

use crate::{
    process::{npm, CommandSpec},
    release::test_build,
    workspace::Workspace,
};

use super::tools;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Test,
    Release,
}

pub(super) fn run(workspace: &Workspace) -> Result<()> {
    let kind = cliclack::select("What kind of build?")
        .item(Kind::Test, "Test build for this computer, unsigned", "")
        .item(Kind::Release, "Release, signed and published", "")
        .interact()?;
    if kind == Kind::Release {
        return super::release::run(workspace, false);
    }
    offer_latest_code(workspace)?;
    let problems = tools::missing(workspace);
    if !problems.is_empty() {
        for problem in &problems {
            cliclack::log::error(format!("{}: {}", problem.tool, problem.fix))?;
        }
        bail!("install what's listed above, then run this again");
    }
    cliclack::log::success("This computer has the tools it needs.")?;
    install_dependencies(workspace)?;

    cliclack::log::step("Building. The first build takes a while.")?;
    let installer = test_build::run(workspace)?;

    cliclack::log::success(format!("Built {}", installer.display()))?;
    if cfg!(windows) {
        cliclack::log::info(
            "Windows warns about unsigned apps: choose More info, then Run anyway.",
        )?;
    }
    if cliclack::confirm("Show it in its folder?")
        .initial_value(true)
        .interact()?
    {
        reveal(workspace, &installer)?;
    }
    cliclack::outro("Done.")?;
    Ok(())
}

/// A build should be of the code you think it is, so a checkout behind its remote says so.
fn offer_latest_code(workspace: &Workspace) -> Result<()> {
    let git = |args: &[&str]| CommandSpec::new("git").args(args).capture(&workspace.misty);
    if git(&["fetch", "--quiet"]).is_err() {
        cliclack::log::warning("Couldn't reach the remote, so this builds what's here.")?;
        return Ok(());
    }
    let Ok(behind) = git(&["rev-list", "--count", "HEAD..@{upstream}"]) else {
        return Ok(());
    };
    let behind = behind.trim().parse::<u32>().unwrap_or(0);
    if behind > 0
        && cliclack::confirm(format!("Pull the {behind} new commits first?"))
            .initial_value(true)
            .interact()?
    {
        CommandSpec::new("git")
            .args(["pull", "--ff-only"])
            .run(&workspace.misty)?;
    }
    Ok(())
}

/// Skips `npm ci` when the install already matches the lockfile.
fn install_dependencies(workspace: &Workspace) -> Result<()> {
    if !dependencies_stale(&workspace.misty) {
        return Ok(());
    }
    cliclack::log::step("Installing dependencies.")?;
    CommandSpec::new(npm()).args(["ci"]).run(&workspace.misty)
}

fn dependencies_stale(root: &std::path::Path) -> bool {
    let modified = |path: std::path::PathBuf| path.metadata().and_then(|file| file.modified());
    match (
        modified(root.join("package-lock.json")),
        modified(root.join("node_modules/.package-lock.json")),
    ) {
        (Ok(lockfile), Ok(installed)) => lockfile > installed,
        _ => true,
    }
}

fn reveal(workspace: &Workspace, path: &std::path::Path) -> Result<()> {
    let folder = path.parent().unwrap_or(path);
    if cfg!(windows) {
        // Explorer exits with 1 even when it opened the folder.
        let _ = CommandSpec::new("explorer")
            .arg(folder)
            .run(&workspace.misty);
        return Ok(());
    }
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    CommandSpec::new(opener).arg(folder).run(&workspace.misty)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dependencies_are_stale_until_installed_after_the_lockfile() {
        let root = tempfile::tempdir().unwrap();
        assert!(dependencies_stale(root.path()));
        std::fs::write(root.path().join("package-lock.json"), "{}").unwrap();
        assert!(dependencies_stale(root.path()));
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::create_dir(root.path().join("node_modules")).unwrap();
        std::fs::write(root.path().join("node_modules/.package-lock.json"), "{}").unwrap();
        assert!(!dependencies_stale(root.path()));
    }
}
