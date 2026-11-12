//! "Publish a release": works out how far a version has got and offers the next step, so the
//! same flow starts a release, continues it on a second computer and publishes it.

use anyhow::Result;

use crate::{
    release::{self, ReleaseOs, Stage},
    workspace::Workspace,
};

pub(super) fn run(workspace: &Workspace, dry_run: bool) -> Result<()> {
    if dry_run {
        cliclack::log::info("Dry run: nothing is tagged, uploaded or published.")?;
    }
    release::check(workspace)?;
    let current = release::app_version(workspace)?;
    let version: String = cliclack::input("Which version?")
        .default_input(&current)
        .validate(|value: &String| {
            release::normalize_version(value)
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .interact()?;
    let version = release::normalize_version(&version)?;

    loop {
        match release::stage(workspace, &version)? {
            Stage::Published => {
                cliclack::outro(format!("Misty {version} is already public."))?;
                return Ok(());
            }
            Stage::NotStarted => {
                if !start(workspace, &version, dry_run)? {
                    return leave();
                }
                if dry_run {
                    cliclack::outro("The dry run stops here: later steps need a real draft.")?;
                    return Ok(());
                }
            }
            Stage::Draft { here, elsewhere } if !here.is_empty() => {
                let ask = format!("Build and upload {} now?", here.join(", "));
                if !confirm(&ask, true)? {
                    return leave();
                }
                release::build(workspace, &version, dry_run)?;
                release::upload(workspace, &version, dry_run)?;
                if dry_run {
                    cliclack::outro("Dry run finished.")?;
                    return Ok(());
                }
                if !elsewhere.is_empty() {
                    continue;
                }
            }
            Stage::Draft { elsewhere, .. } if !elsewhere.is_empty() => {
                cliclack::outro(format!(
                    "Next: run `misty release` for {version} on the computer that builds {}, at this same commit.",
                    elsewhere.join(", ")
                ))?;
                return Ok(());
            }
            Stage::Draft { .. } => {
                let ask = format!(
                    "Make Misty {version} public? Installed apps will update to it, and it can't be replaced"
                );
                if !confirm(&ask, false)? {
                    return leave();
                }
                release::publish(workspace, &version, true, dry_run)?;
                cliclack::outro(format!("Misty {version} is public."))?;
                return Ok(());
            }
        }
    }
}

fn start(workspace: &Workspace, version: &str, dry_run: bool) -> Result<bool> {
    let systems: Vec<ReleaseOs> = cliclack::select("Which systems does this release cover?")
        .item(
            vec![ReleaseOs::Macos, ReleaseOs::Windows, ReleaseOs::Linux],
            "macOS, Windows and Linux",
            "",
        )
        .item(vec![], "Only this computer's system", "")
        .interact()?;
    let ask =
        format!("Start {version}? This runs every check, then tags the source and makes a draft");
    if !confirm(&ask, true)? {
        return Ok(false);
    }
    release::start(workspace, version, dry_run, &systems)?;
    Ok(true)
}

fn confirm(question: &str, initial: bool) -> Result<bool> {
    Ok(cliclack::confirm(question)
        .initial_value(initial)
        .interact()?)
}

fn leave() -> Result<()> {
    cliclack::outro("Stopped. Run `misty release` to pick up from here.")?;
    Ok(())
}
