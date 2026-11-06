//! Arguments for `misty server`, which runs the development stack. A server
//! is deployed with misty-server/compose.yml instead (docs/self-hosting.md).

use super::*;

#[derive(Debug, Args)]
pub(super) struct Server {
    #[command(subcommand)]
    pub(super) command: ServerCommand,
}

#[derive(Debug, Subcommand)]
pub(super) enum ServerCommand {
    /// Start every local service, wait for readiness, and return with a status summary.
    Up {
        #[arg(long)]
        no_build: bool,
        /// Stream underlying build output.
        #[arg(long)]
        verbose: bool,
        /// Also open the local operator console in your browser.
        #[arg(long)]
        gui: bool,
    },
    /// Show service health and any unfinished or failed setup jobs.
    Status,
    /// Deploy the development collaboration Worker explicitly.
    Deploy,
    Url,
    /// Stop every local service.
    Down {
        /// Also delete the server's data volumes.
        #[arg(long)]
        volumes: bool,
    },
    /// Show recent service logs; add --follow to stream.
    Logs {
        service: Option<String>,
        #[arg(long)]
        follow: bool,
        #[arg(long, default_value_t = 100)]
        tail: u32,
    },
    Worker {
        #[command(subcommand)]
        command: WorkerCommand,
    },
    R2 {
        #[command(subcommand)]
        command: R2Command,
    },
}

#[derive(Debug, Subcommand)]
pub(super) enum WorkerCommand {
    /// Generate the development collaboration Worker's keys.
    GenerateSecrets,
}

#[derive(Debug, Subcommand)]
pub(super) enum R2Command {
    ConfigureCors {
        #[arg(long)]
        apply: bool,
    },
}
