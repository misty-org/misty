//! `misty` with no arguments: everything the CLI does, asked one step at a time.
//! Each flow calls the same functions the named commands call.

mod build;
mod develop;
mod release;
mod tools;

use std::io::{self, IsTerminal};

use anyhow::{bail, Result};

use crate::{config::Settings, workspace::Workspace};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Choice {
    Build,
    RunApp,
    Server,
    Checks,
    Release,
    SetUp,
}

/// The menu `misty` opens with.
pub fn menu(settings: &Settings) -> Result<()> {
    guided(|| {
        let workspace = &settings.workspace;
        let choice = cliclack::select("What do you want to do?")
            .item(Choice::Build, "Build the app", "")
            .item(Choice::RunApp, "Run the app in development", "")
            .item(Choice::Server, "Manage the development server", "")
            .item(Choice::Checks, "Run checks", "")
            .item(Choice::Release, "Publish a release", "")
            .item(Choice::SetUp, "Set up this computer", "")
            .interact()?;
        match choice {
            Choice::Build => build::run(workspace),
            Choice::RunApp => develop::run_app(workspace),
            Choice::Server => develop::server(workspace),
            Choice::Checks => develop::checks(workspace),
            Choice::Release => release::run(workspace, false),
            Choice::SetUp => develop::set_up(workspace),
        }
    })
}

/// `misty build`.
pub fn build(workspace: &Workspace) -> Result<()> {
    guided(|| build::run(workspace))
}

/// `misty release`.
pub fn release(workspace: &Workspace, dry_run: bool) -> Result<()> {
    guided(|| release::run(workspace, dry_run))
}

/// Frames a flow, and treats Ctrl-C or Esc at a question as leaving, not as a failure.
fn guided(flow: impl FnOnce() -> Result<()>) -> Result<()> {
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
        bail!("this step asks questions, so it needs a terminal; run `misty --help` for the rest");
    }
    cliclack::intro("Misty")?;
    match flow() {
        Err(error) if interrupted(&error) => {
            cliclack::outro_cancel("Nothing else was changed.")?;
            Ok(())
        }
        Err(error) => {
            cliclack::outro_cancel("That step failed.")?;
            Err(error)
        }
        Ok(()) => Ok(()),
    }
}

fn interrupted(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<io::Error>()
        .is_some_and(|error| error.kind() == io::ErrorKind::Interrupted)
}
