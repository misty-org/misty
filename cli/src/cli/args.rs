//! The top-level command surface parsed by clap.

use super::*;

#[derive(Debug, Parser)]
#[command(name = "misty", version, about)]
pub struct Cli {
    #[arg(long, global = true)]
    pub workspace: Option<PathBuf>,
    #[command(subcommand)]
    pub(super) command: Command,
}

#[derive(Debug, Subcommand)]
pub(super) enum Command {
    /// Prepare server configuration, Cloudflare resources, or desktop dependencies.
    Setup(crate::setup::Setup),
    /// Run a project tool using the shared .config registry.
    Tool {
        name: String,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        arguments: Vec<String>,
    },
    /// List internal TypeScript build tasks.
    Tasks,
    /// Run an internal build task (see `misty tasks`).
    Task {
        name: String,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        arguments: Vec<String>,
    },
    Configure(Configure),
    /// Diagnose setup and service health; choose server, desktop, cloudflare, or release.
    Doctor(crate::diagnostics::Doctor),
    /// Create and validate private runtime environments.
    Env(Env),
    /// Generate and validate the cross-platform ~/.misty home.
    Home(Home),
    Check(Check),
    Desktop(Desktop),
    /// Run the documentation site.
    Docs(Docs),
    /// Run the public website.
    Website(Website),
    Server(Server),
    Release(Release),
}

#[derive(Debug, Args)]
pub(super) struct Configure {
    #[arg(long)]
    pub(super) workspace: PathBuf,
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
    /// Create missing private files without overwriting configured values.
    /// For prod, also generate any missing production secrets locally.
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
    Build,
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
    #[command(subcommand)]
    pub(super) command: ReleaseCommand,
}

#[derive(Debug, Subcommand)]
pub(super) enum ReleaseCommand {
    /// Validate locally saved release configuration before compiling or uploading.
    Check,
    Start {
        version: String,
        #[arg(long)]
        dry_run: bool,
        /// Release operating systems, comma-separated; defaults to the current OS.
        #[arg(long, value_enum, value_delimiter = ',')]
        os: Vec<release::ReleaseOs>,
    },
    Build {
        version: String,
        /// Upload verified local artifacts to the draft after building.
        #[arg(long)]
        upload: bool,
        #[arg(long)]
        dry_run: bool,
    },
    Upload {
        version: String,
        #[arg(long)]
        dry_run: bool,
    },
    Verify {
        version: String,
        #[arg(long)]
        dry_run: bool,
    },
    Publish {
        version: String,
        #[arg(long)]
        yes: bool,
        #[arg(long)]
        dry_run: bool,
    },
}
