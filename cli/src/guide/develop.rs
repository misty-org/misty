//! The everyday flows: the app in development, its server, checks and first-time setup.

use anyhow::Result;

use crate::{checks, desktop, environment, server, setup, workspace::Workspace};

use super::tools;

pub(super) fn run_app(workspace: &Workspace) -> Result<()> {
    let separate = cliclack::select("Which copy of the app?")
        .item(false, "The usual one", "")
        .item(
            true,
            "A separate profile, to test sync beside the usual one",
            "",
        )
        .interact()?;
    let profile: Option<String> = if separate {
        Some(
            cliclack::input("Name this profile")
                .default_input("dev2")
                .validate(|name: &String| {
                    desktop::validate_profile(Some(name)).map_err(|e| e.to_string())
                })
                .interact()?,
        )
    } else {
        None
    };
    cliclack::outro("Starting the app. Press Ctrl-C here to stop it.")?;
    desktop::dev(workspace, profile.as_deref(), None)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ServerAction {
    Start,
    Status,
    Logs,
    Console,
    Stop,
}

pub(super) fn server(workspace: &Workspace) -> Result<()> {
    let action = cliclack::select("What should the development server do?")
        .item(ServerAction::Start, "Start", "")
        .item(ServerAction::Status, "Show its status", "")
        .item(ServerAction::Logs, "Show recent logs", "")
        .item(ServerAction::Console, "Open the operator console", "")
        .item(ServerAction::Stop, "Stop, keeping its data", "")
        .interact()?;
    environment::apply(workspace)?;
    match action {
        ServerAction::Start => server::up(workspace, true, false)?,
        ServerAction::Status => server::status(workspace)?,
        ServerAction::Logs => server::logs(workspace, None, false, 100)?,
        ServerAction::Console => crate::console::open(workspace)?,
        ServerAction::Stop => {
            crate::console::stop(workspace)?;
            server::down(workspace, false)?;
        }
    }
    cliclack::outro("Done.")?;
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Checks {
    All,
    App,
    Server,
    Website,
    Cli,
}

pub(super) fn checks(workspace: &Workspace) -> Result<()> {
    let target = cliclack::select("Which checks?")
        .item(Checks::All, "Everything", "")
        .item(Checks::App, "The app", "")
        .item(Checks::Server, "The server", "")
        .item(Checks::Website, "The website", "")
        .item(Checks::Cli, "This CLI", "")
        .interact()?;
    match target {
        Checks::All => checks::all(workspace)?,
        Checks::App => checks::app(workspace)?,
        Checks::Server => checks::server(workspace)?,
        Checks::Website => checks::website(workspace)?,
        Checks::Cli => checks::cli(workspace)?,
    }
    cliclack::outro("Every check passed.")?;
    Ok(())
}

pub(super) fn set_up(workspace: &Workspace) -> Result<()> {
    let problems = tools::missing(workspace);
    if !problems.is_empty() {
        for problem in &problems {
            cliclack::log::error(format!("{}: {}", problem.tool, problem.fix))?;
        }
        anyhow::bail!("install what's listed above, then run this again");
    }
    cliclack::log::success("This computer has the tools it needs.")?;
    cliclack::log::step("Installing dependencies.")?;
    setup::desktop(workspace)?;
    cliclack::outro("Ready. Run `misty` and choose Build the app.")?;
    Ok(())
}
