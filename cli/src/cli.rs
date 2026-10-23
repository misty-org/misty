use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::{
    checks, config::Settings, deploy, desktop, environment, home, release, server, website,
};

mod args;
mod dispatch;
mod doctor;
mod server_args;
#[cfg(test)]
mod tests;

pub use args::Cli;
use args::*;
pub use dispatch::dispatch;
use doctor::*;
use server_args::*;
