//! The top-level command surface parsed by clap.

use super::*;

#[derive(Debug, Parser)]
#[command(name = "misty", version, about)]
pub struct Cli {
    #[arg(long, global = true)]
    pub workspace: Option<PathBuf>,
    /// Leave this out to be asked what to do, one step at a time.
    #[command(subcommand)]
    pub(super) command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub(super) enum Command {
    /// Prepare server configuration, Cloudflare resources, or desktop dependencies.
    Setup(crate::setup::Setup),
    /// Diagnose setup and service health; choose server, desktop, cloudflare, or release.
    Doctor(crate::diagnostics::Doctor),
    /// Create and validate private runtime environments.
    Env(Env),
    /// Generate and validate the cross-platform ~/.misty home.
    Home(Home),
    Check(Check),
    /// Build the app, step by step.
    Build,
    Desktop(Desktop),
    /// Run the documentation site.
    Docs(Docs),
    /// Run the public website.
    Website(Website),
    Server(Server),
    /// Publish a release, step by step: start it, build it on each system, make it public.
    Release(Release),
}

#[derive(Debug, Args)]
pub(super) struct Check {
    #[arg(value_enum)]
    pub(super) target: CheckTarget,
}

#[derive(Debug, Args)]
pub(super) struct Env {
    #[command(subcommand)]
    pub(super) command: EnvCommand,
}

#[derive(Debug, Args)]
pub(super) struct Home {
    #[command(subcommand)]
    pub(super) command: HomeCommand,
}

#[derive(Debug, Subcommand)]
pub(super) enum HomeCommand {
    /// Create a deterministic, non-destructive Misty home directory.
    Generate {
        /// Exact output directory. Defaults to ~/.misty.
        #[arg(long)]
        destination: Option<PathBuf>,
    },
    /// Validate layout, permissions, and retired paths without displaying values.
    Check {
        /// Exact Misty home to validate. Defaults to ~/.misty.
        #[arg(long)]
        path: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
pub(super) enum EnvCommand {
    /// Save a setting in its registered file; read the value from stdin.
    Set {
        #[arg(value_enum)]
        target: environment::Target,
        name: String,
    },
    /// List environment settings and the files that own them.
    Describe,
    /// Create missing private development files without overwriting configured values.
    Init {
        #[arg(value_enum)]
        target: environment::Target,
    },
    /// Validate ownership, duplicates, permissions, and required values.
    Check {
        #[arg(value_enum)]
        target: environment::Target,
    },
    /// Show configured counts and missing names without displaying values.
    Status {
        #[arg(value_enum)]
        target: environment::Target,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub(super) enum CheckTarget {
    Scripts,
    App,
    Server,
    GoSizes,
    Website,
    Features,
    Cli,
    All,
}

#[derive(Debug, Args)]
pub(super) struct Desktop {
    #[command(subcommand)]
    pub(super) command: DesktopCommand,
}

#[derive(Debug, Args)]
pub(super) struct Website {
    #[command(subcommand)]
    pub(super) command: WebsiteCommand,
}

#[derive(Debug, Args)]
pub(super) struct Docs {
    #[command(subcommand)]
    pub(super) command: DocsCommand,
}

#[derive(Debug, Subcommand)]
pub(super) enum DocsCommand {
    /// Build the independently deployed documentation site.
    Build,
    /// Start the Vite development server.
    Dev,
}

#[derive(Debug, Subcommand)]
pub(super) enum WebsiteCommand {
    /// Start the Vite development server.
    Dev,
}

#[derive(Debug, Subcommand)]
pub(super) enum DesktopCommand {
    Dev {
        #[arg(long)]
        profile: Option<String>,
        #[arg(long)]
        route: Option<String>,
    },
    Clean {
        #[arg(long)]
        apply: bool,
    },
    Icons {
        #[command(subcommand)]
        command: IconCommand,
    },
}

#[derive(Debug, Subcommand)]
pub(super) enum IconCommand {
    Sync {
        #[arg(long)]
        source: Option<PathBuf>,
    },
}

#[derive(Debug, Args)]
pub(super) struct Release {
    /// Walk through the steps without tagging, uploading or publishing anything.
    #[arg(long)]
    pub(super) dry_run: bool,
}
