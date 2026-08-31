mod artifacts;
mod checks;
mod cli;
mod config;
mod desktop;
mod environment;
mod home;
mod process;
mod release;
mod server;
mod website;
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
    cli::dispatch(arguments, settings)
}
