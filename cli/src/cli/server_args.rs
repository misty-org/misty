//! Arguments for `misty server` and its production, staging and Worker commands.

use super::*;

#[derive(Debug, Args)]
pub(super) struct Server {
    #[command(subcommand)]
    pub(super) command: ServerCommand,
}

#[derive(Debug, Subcommand)]
pub(super) enum ServerCommand {
    /// Start every local service (billing first, migrated and rebuilt, then the
    /// server's containers), wait for readiness, and return with a status summary.
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
    /// Stop every local service, billing included.
    Down {
        /// Also delete the server's data volumes. Billing's database is never deleted here.
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
    /// Test, build and push the production images from this computer, tag the
    /// commit, and save the image digests in server/.env/prod.
    Release {
        /// Release version, such as 0.1.0 (tagged server-v0.1.0).
        version: String,
    },
    /// Operate the production Compose stack explicitly.
    Prod {
        #[command(subcommand)]
        command: ProdCommand,
    },
    /// Operate the isolated staging Compose stack.
    Staging {
        #[command(subcommand)]
        command: StagingCommand,
    },
    Image {
        #[command(subcommand)]
        command: ImageCommand,
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
pub(super) enum ProdCommand {
    Check,
    Up,
    Down {
        #[arg(long)]
        volumes: bool,
    },
    Logs,
    /// Encrypt both databases with age and upload them to the backup bucket.
    Backup,
    /// Copy this computer's server/.env/prod (and misty-billing/.env/prod) to the VPS.
    Push(DeployTarget),
    /// Push the production environment, then update and start both stacks on the VPS.
    Deploy(DeployTarget),
    /// Replace both databases with a backup from the bucket.
    Restore {
        /// Backup timestamp such as 20271003T020000Z, or `latest`.
        backup: String,
        /// age identity file that decrypts the backup.
        #[arg(long)]
        identity: PathBuf,
        /// Confirm that production data will be replaced.
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Debug, Subcommand)]
pub(super) enum StagingCommand {
    /// Validate staging configuration and Compose expansion.
    Check,
    /// Build the current checkout and start staging on this host.
    Up,
    /// Stop staging. Data volumes are retained unless --volumes is supplied.
    Down {
        #[arg(long)]
        volumes: bool,
    },
    /// Show staging container status.
    Status,
    /// Follow staging container logs.
    Logs,
}

#[derive(Debug, Args)]
pub(super) struct DeployTarget {
    /// SSH destination such as misty@203.0.113.10; defaults to MISTY_DEPLOY_HOST.
    #[arg(long)]
    pub(super) host: Option<String>,
    /// Misty checkout on the VPS, relative to the SSH user's home.
    #[arg(long, default_value = "misty")]
    pub(super) dir: String,
    /// Directory for billing's deploy files on the VPS, relative to the SSH user's home.
    #[arg(long, default_value = "misty-billing")]
    pub(super) billing_dir: String,
}

impl DeployTarget {
    pub(super) fn remote(&self) -> Result<deploy::Remote> {
        let host = match &self.host {
            Some(host) => host.clone(),
            None => std::env::var("MISTY_DEPLOY_HOST").map_err(|_| {
                anyhow::anyhow!("pass --host or set MISTY_DEPLOY_HOST in misty/cli/.env/common.env")
            })?,
        };
        deploy::Remote::new(&host, &self.dir, &self.billing_dir)
    }
}

#[derive(Debug, Subcommand)]
pub(super) enum ImageCommand {
    Build {
        #[arg(long)]
        tag: String,
    },
}

#[derive(Debug, Subcommand)]
pub(super) enum WorkerCommand {
    GenerateSecrets {
        #[arg(long, value_enum, default_value = "development")]
        target: WorkerSecretTarget,
    },
    Deploy {
        #[arg(long, value_enum)]
        target: WorkerDeployTarget,
        #[arg(long)]
        dry_run: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub(super) enum WorkerSecretTarget {
    Development,
    Production,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub(super) enum WorkerDeployTarget {
    Production,
}

#[derive(Debug, Subcommand)]
pub(super) enum R2Command {
    ConfigureCors {
        #[arg(long)]
        apply: bool,
    },
}
