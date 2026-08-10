mod artifacts;
mod checks;
mod cli;
mod config;
mod desktop;
mod file_manager;
mod process;
mod release;
mod server;
mod workspace;

use anyhow::Result;
use clap::Parser;

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let arguments = cli::Cli::parse();
    let settings = config::Settings::load(arguments.workspace.as_deref())?;
    config::load_workspace_environment(&settings.workspace)?;
    cli::dispatch(arguments, settings)
}
