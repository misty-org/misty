use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::{
    checks, config::Settings, deploy, desktop, environment, home, release, server, server_release,
    website,
};

#[derive(Debug, Parser)]
#[command(name = "misty", version, about)]
pub struct Cli {
    #[arg(long, global = true)]
    pub workspace: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
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
struct Configure {
    #[arg(long)]
    workspace: PathBuf,
}

#[derive(Debug, Args)]
struct Check {
    #[arg(value_enum)]
    target: CheckTarget,
}

#[derive(Debug, Args)]
struct Env {
    #[command(subcommand)]
    command: EnvCommand,
}

#[derive(Debug, Args)]
struct Home {
    #[command(subcommand)]
    command: HomeCommand,
}

#[derive(Debug, Subcommand)]
enum HomeCommand {
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
enum EnvCommand {
    /// Save a setting in its registered file; read the value from stdin.
    Set {
        #[arg(value_enum)]
        target: environment::Target,
        name: String,
    },
    /// List environment settings and the files that own them.
    Describe,
    /// Split legacy private files into the scoped layout.
    Migrate,
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
enum CheckTarget {
    Tasks,
    App,
    Server,
    Website,
    Tools,
    Cli,
    All,
}

#[derive(Debug, Args)]
struct Desktop {
    #[command(subcommand)]
    command: DesktopCommand,
}

#[derive(Debug, Args)]
struct Website {
    #[command(subcommand)]
    command: WebsiteCommand,
}

#[derive(Debug, Args)]
struct Docs {
    #[command(subcommand)]
    command: DocsCommand,
}

#[derive(Debug, Subcommand)]
enum DocsCommand {
    /// Build the independently deployed documentation site.
    Build,
    /// Start the Vite development server.
    Dev,
}

#[derive(Debug, Subcommand)]
enum WebsiteCommand {
    /// Start the Vite development server.
    Dev,
}

#[derive(Debug, Subcommand)]
enum DesktopCommand {
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
enum IconCommand {
    Sync {
        #[arg(long)]
        source: Option<PathBuf>,
    },
}

#[derive(Debug, Args)]
struct Server {
    #[command(subcommand)]
    command: ServerCommand,
}

#[derive(Debug, Subcommand)]
enum ServerCommand {
    /// Start containers, wait for readiness, and return with a status summary.
    Up {
        #[arg(long)]
        detach: bool,
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
    Down {
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
enum ProdCommand {
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

#[derive(Debug, Args)]
struct DeployTarget {
    /// SSH destination such as misty@203.0.113.10; defaults to MISTY_DEPLOY_HOST.
    #[arg(long)]
    host: Option<String>,
    /// Misty checkout on the VPS, relative to the SSH user's home.
    #[arg(long, default_value = "misty")]
    dir: String,
    /// Directory for billing's deploy files on the VPS, relative to the SSH user's home.
    #[arg(long, default_value = "misty-billing")]
    billing_dir: String,
}

impl DeployTarget {
    fn remote(&self) -> Result<deploy::Remote> {
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
enum ImageCommand {
    Build {
        #[arg(long)]
        tag: String,
    },
}

#[derive(Debug, Subcommand)]
enum WorkerCommand {
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
enum WorkerSecretTarget {
    Development,
    Production,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum WorkerDeployTarget {
    Production,
}

#[derive(Debug, Subcommand)]
enum R2Command {
    ConfigureCors {
        #[arg(long)]
        apply: bool,
    },
}

#[derive(Debug, Args)]
struct Release {
    #[command(subcommand)]
    command: ReleaseCommand,
}

#[derive(Debug, Subcommand)]
enum ReleaseCommand {
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

pub fn dispatch(arguments: Cli, settings: Settings) -> Result<()> {
    load_command_environment(&arguments.command, &settings)?;
    match arguments.command {
        Command::Tool { name, arguments } => crate::process::CommandSpec::new("node")
            .arg(
                settings
                    .workspace
                    .misty
                    .join("cli/tasks/run-tool.ts")
                    .into_os_string(),
            )
            .arg(name)
            .args(arguments)
            .run(&settings.workspace.misty),
        Command::Setup(options) => crate::setup::run(&settings.workspace, options),
        Command::Tasks => crate::development::tasks(&settings.workspace),
        Command::Task { name, arguments } => {
            crate::development::task(&settings.workspace, &name, &arguments)
        }
        Command::Configure(command) => {
            let path = Settings::save_workspace(&command.workspace)?;
            println!("Saved workspace configuration to {}", path.display());
            Ok(())
        }
        Command::Doctor(options) => {
            if options.target == crate::diagnostics::Target::Release {
                if options.json || options.fix {
                    anyhow::bail!(
                        "release doctor supports text diagnostics only; omit --json and --fix"
                    );
                }
                doctor(&settings)
            } else {
                crate::diagnostics::run(&settings.workspace, options)
            }
        }
        Command::Env(command) => match command.command {
            EnvCommand::Describe => environment::describe(),
            EnvCommand::Set { target, name } => {
                use std::io::Read;
                let mut value = String::new();
                std::io::stdin().read_to_string(&mut value)?;
                environment::set(
                    &settings.workspace,
                    target,
                    &name,
                    value.trim_end_matches(['\r', '\n']),
                )
            }
            EnvCommand::Migrate => environment::migrate(&settings.workspace),
            EnvCommand::Init { target } => {
                environment::init(&settings.workspace, target)?;
                match target {
                    environment::Target::Dev => {
                        server::initialize_development_secrets(&settings.workspace)
                    }
                    environment::Target::Prod => {
                        deploy::initialize_production_secrets(&settings.workspace)
                    }
                }
            }
            EnvCommand::Check { target } => environment::check(&settings.workspace, target),
            EnvCommand::Status { target } => environment::status(&settings.workspace, target),
        },
        Command::Home(command) => match command.command {
            HomeCommand::Generate { destination } => home::generate(destination.as_deref()),
            HomeCommand::Check { path } => home::check(path.as_deref()),
        },
        Command::Check(command) => match command.target {
            CheckTarget::App => checks::app(&settings.workspace),
            CheckTarget::Tasks => crate::process::CommandSpec::new(crate::process::npm())
                .args(["run", "test:tasks"])
                .run(&settings.workspace.misty),
            CheckTarget::Server => checks::server(&settings.workspace),
            CheckTarget::Website => checks::website(&settings.workspace),
            CheckTarget::Tools => checks::builtin_tools(&settings.workspace),
            CheckTarget::Cli => checks::cli(&settings.workspace),
            CheckTarget::All => {
                checks::app(&settings.workspace)?;
                crate::process::CommandSpec::new(crate::process::npm())
                    .args(["run", "test:tasks"])
                    .run(&settings.workspace.misty)?;
                checks::server(&settings.workspace)?;
                checks::website(&settings.workspace)?;
                checks::builtin_tools(&settings.workspace)?;
                checks::cli(&settings.workspace)
            }
        },
        Command::Desktop(command) => match command.command {
            DesktopCommand::Dev { profile, route } => {
                desktop::dev(&settings.workspace, profile.as_deref(), route.as_deref())
            }
            DesktopCommand::Build => desktop::build(&settings.workspace),
            DesktopCommand::Clean { apply } => desktop::clean(&settings.workspace, apply),
            DesktopCommand::Icons { command } => match command {
                IconCommand::Sync { source } => {
                    desktop::sync_icons(&settings.workspace, source.as_deref())
                }
            },
        },

        Command::Docs(command) => match command.command {
            DocsCommand::Dev => website::docs(&settings.workspace),
            DocsCommand::Build => website::docs_build(&settings.workspace),
        },
        Command::Website(command) => match command.command {
            WebsiteCommand::Dev => website::dev(&settings.workspace),
        },
        Command::Server(command) => match command.command {
            ServerCommand::Up {
                detach: _,
                no_build,
                verbose,
                gui,
            } => {
                server::up(&settings.workspace, true, !no_build, verbose)?;
                if gui {
                    crate::console::open(&settings.workspace)
                } else {
                    println!("Console: misty server up --gui");
                    Ok(())
                }
            }
            ServerCommand::Status => server::status(&settings.workspace),
            ServerCommand::Deploy => server::deploy_development(&settings.workspace),
            ServerCommand::Url => server::url(&settings.workspace),
            ServerCommand::Down { volumes } => {
                crate::console::stop(&settings.workspace)?;
                server::down(&settings.workspace, volumes)
            }
            ServerCommand::Logs {
                service,
                follow,
                tail,
            } => server::logs(&settings.workspace, service.as_deref(), follow, tail),
            ServerCommand::Release { version } => {
                server_release::release(&settings.workspace, &version)
            }
            ServerCommand::Prod { command } => match command {
                ProdCommand::Check => server::production_check(&settings.workspace),
                ProdCommand::Up => server::production_up(&settings.workspace),
                ProdCommand::Down { volumes } => {
                    server::production_down(&settings.workspace, volumes)
                }
                ProdCommand::Logs => server::production_logs(&settings.workspace),
                ProdCommand::Backup => server::production_backup(&settings.workspace),
                ProdCommand::Push(target) => deploy::push(&settings.workspace, &target.remote()?),
                ProdCommand::Deploy(target) => {
                    deploy::deploy(&settings.workspace, &target.remote()?)
                }
                ProdCommand::Restore {
                    backup,
                    identity,
                    yes,
                } => server::production_restore(&settings.workspace, &backup, &identity, yes),
            },
            ServerCommand::Image { command } => match command {
                ImageCommand::Build { tag } => server::build_image(&settings.workspace, &tag),
            },
            ServerCommand::Worker { command } => match command {
                WorkerCommand::GenerateSecrets { target } => match target {
                    WorkerSecretTarget::Development => {
                        server::generate_worker_secrets(&settings.workspace)
                    }
                    WorkerSecretTarget::Production => {
                        server::generate_production_worker_secrets(&settings.workspace)
                    }
                },
                WorkerCommand::Deploy { target, dry_run } => match target {
                    WorkerDeployTarget::Production => {
                        server::deploy_production_worker(&settings.workspace, dry_run)
                    }
                },
            },
            ServerCommand::R2 { command } => match command {
                R2Command::ConfigureCors { apply } => {
                    server::configure_r2_cors(&settings.workspace, apply)
                }
            },
        },
        Command::Release(command) => match command.command {
            ReleaseCommand::Check => release::check(&settings.workspace),
            ReleaseCommand::Start {
                version,
                dry_run,
                os,
            } => release::start(&settings.workspace, &version, dry_run, &os),
            ReleaseCommand::Build {
                version,
                dry_run,
                upload,
            } => {
                release::build(&settings.workspace, &version, dry_run)?;
                if upload && !dry_run {
                    release::upload(&settings.workspace, &version, false)?;
                }
                Ok(())
            }
            ReleaseCommand::Upload { version, dry_run } => {
                release::upload(&settings.workspace, &version, dry_run)
            }
            ReleaseCommand::Verify { version, dry_run } => {
                release::verify(&settings.workspace, &version, dry_run)
            }
            ReleaseCommand::Publish {
                version,
                yes,
                dry_run,
            } => release::publish(&settings.workspace, &version, yes, dry_run),
        },
    }
}

fn load_command_environment(command: &Command, settings: &Settings) -> Result<()> {
    let files: &[&str] = match command {
        Command::Configure(_) | Command::Env(_) | Command::Home(_) | Command::Tasks => &[],
        Command::Task { name, .. } if name.starts_with("release/") => {
            &["common.env", "release.env"]
        }
        Command::Task { .. } => &["common.env"],
        Command::Setup(options)
            if matches!(options.component, crate::setup::Component::Cloudflare) =>
        {
            &["common.env", "cloudflare.env"]
        }
        Command::Setup(_) => &["common.env"],
        Command::Doctor(options) if options.target == crate::diagnostics::Target::Release => {
            &["common.env", "release.env"]
        }
        Command::Doctor(options) if options.target == crate::diagnostics::Target::Cloudflare => {
            &["common.env", "cloudflare.env"]
        }
        Command::Doctor(_) => &["common.env"],
        Command::Release(_) => &["common.env", "release.env"],
        Command::Desktop(desktop) => match desktop.command {
            DesktopCommand::Build => &["common.env", "release.env"],
            _ => &["common.env"],
        },

        Command::Server(server) => match &server.command {
            ServerCommand::Worker { .. } | ServerCommand::R2 { .. } => {
                &["common.env", "cloudflare.env"]
            }
            _ => &["common.env"],
        },
        Command::Tool { .. } | Command::Check(_) | Command::Docs(_) | Command::Website(_) => {
            &["common.env"]
        }
    };
    crate::config::load_cli_environment(&settings.workspace, files)?;
    if let Command::Server(server) = command {
        let target = match &server.command {
            ServerCommand::Prod { .. } => environment::Target::Prod,
            ServerCommand::Worker {
                command: WorkerCommand::GenerateSecrets { target },
            } => match target {
                WorkerSecretTarget::Development => environment::Target::Dev,
                WorkerSecretTarget::Production => environment::Target::Prod,
            },
            ServerCommand::Worker {
                command: WorkerCommand::Deploy { .. },
            } => environment::Target::Prod,
            _ => environment::Target::Dev,
        };
        environment::apply(&settings.workspace, target)?;
    }
    Ok(())
}

fn doctor(settings: &Settings) -> Result<()> {
    crate::workspace::Workspace::validate(&settings.workspace)?;
    let mut commands = vec![
        "node", "npm", "cargo", "rustc", "rustup", "go", "docker", "gh",
    ];
    if cfg!(target_os = "macos") {
        commands.extend(["xcodebuild", "lipo", "codesign", "xcrun", "spctl"]);
    } else if cfg!(windows) {
        commands.extend(["powershell"]);
    }
    let mut missing = Vec::new();
    for command in commands {
        let found = crate::process::command_exists(command);
        println!("{command:<18} {}", if found { "ready" } else { "missing" });
        if !found {
            missing.push(command);
        }
    }
    if !missing.is_empty() {
        anyhow::bail!("missing required commands: {}", missing.join(", "));
    }
    crate::process::CommandSpec::new("gh")
        .args(["auth", "status"])
        .run(&settings.workspace.root)?;
    verify_rust_targets(settings)?;
    crate::process::CommandSpec::new(crate::process::npm())
        .args(["exec", "tauri", "--", "--version"])
        .run(&settings.workspace.misty)?;
    crate::process::CommandSpec::new("cargo")
        .args(["cyclonedx", "--version"])
        .run(&settings.workspace.misty)?;
    release::check(&settings.workspace)?;
    report_repository_status(settings)?;
    println!("workspace  {}", settings.workspace.root.display());
    Ok(())
}

fn verify_rust_targets(settings: &Settings) -> Result<()> {
    let installed = crate::process::CommandSpec::new("rustup")
        .args(["target", "list", "--installed"])
        .capture(&settings.workspace.cli)?;
    let required: &[&str] = if cfg!(target_os = "macos") {
        &["aarch64-apple-darwin", "x86_64-apple-darwin"]
    } else if cfg!(windows) {
        &["x86_64-pc-windows-msvc"]
    } else {
        &[]
    };
    let missing = required
        .iter()
        .filter(|target| !installed.lines().any(|line| line.trim() == **target))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        anyhow::bail!(
            "missing Rust release targets: {}; install them with rustup target add",
            missing.join(", ")
        );
    }
    println!("Rust targets       ready");
    Ok(())
}

fn report_repository_status(settings: &Settings) -> Result<()> {
    for (name, repository) in [
        ("misty", &settings.workspace.misty),
        ("misty-server", &settings.workspace.server),
        ("misty-website", &settings.workspace.website),
    ] {
        if !repository.is_dir() {
            println!("{name:<18} optional checkout absent");
            continue;
        }
        let status = crate::process::CommandSpec::new("git")
            .args(["status", "--porcelain"])
            .capture(repository)?;
        println!(
            "{name:<18} {}",
            if status.trim().is_empty() {
                "clean"
            } else {
                "has local changes"
            }
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_stable_command_surface() {
        for arguments in [
            vec!["misty", "doctor"],
            vec!["misty", "tool", "vite", "build", "--mode", "desktop"],
            vec!["misty", "env", "init", "dev"],
            vec!["misty", "env", "migrate"],
            vec!["misty", "env", "check", "prod"],
            vec!["misty", "env", "status", "dev"],
            vec!["misty", "home", "generate"],
            vec!["misty", "home", "generate", "--destination", "/tmp/.misty"],
            vec!["misty", "home", "check"],
            vec!["misty", "check", "all"],
            vec!["misty", "check", "app"],
            vec!["misty", "check", "server"],
            vec!["misty", "check", "website"],
            vec!["misty", "check", "tools"],
            vec!["misty", "check", "cli"],
            vec!["misty", "desktop", "dev", "--profile", "owner"],
            vec!["misty", "desktop", "build"],
            vec!["misty", "desktop", "clean", "--apply"],
            vec!["misty", "desktop", "icons", "sync"],
            vec!["misty", "docs", "dev"],
            vec!["misty", "website", "dev"],
            vec!["misty", "server", "up", "--detach", "--no-build"],
            vec!["misty", "server", "url"],
            vec!["misty", "server", "down", "--volumes"],
            vec!["misty", "server", "prod", "check"],
            vec!["misty", "server", "prod", "up"],
            vec!["misty", "server", "prod", "down", "--volumes"],
            vec!["misty", "server", "prod", "logs"],
            vec!["misty", "server", "image", "build", "--tag", "local"],
            vec!["misty", "server", "worker", "generate-secrets"],
            vec![
                "misty",
                "server",
                "worker",
                "generate-secrets",
                "--target",
                "production",
            ],
            vec![
                "misty",
                "server",
                "worker",
                "deploy",
                "--target",
                "production",
                "--dry-run",
            ],
            vec!["misty", "server", "r2", "configure-cors", "--apply"],
            vec!["misty", "release", "start", "0.1.0"],
            vec!["misty", "release", "start", "0.1.0", "--os", "macos"],
            vec!["misty", "release", "start", "0.1.0", "--os", "windows"],
            vec!["misty", "release", "verify", "0.1.0", "--dry-run"],
        ] {
            Cli::try_parse_from(arguments).unwrap();
        }
    }

    #[test]
    fn release_os_accepts_multiple_platforms_and_rejects_invalid_values() {
        let parsed = Cli::try_parse_from([
            "misty",
            "release",
            "start",
            "0.1.0",
            "--os",
            "macos,windows",
        ])
        .unwrap();
        let Command::Release(Release {
            command: ReleaseCommand::Start { os, .. },
        }) = parsed.command
        else {
            panic!("expected release start");
        };
        assert_eq!(os, [release::ReleaseOs::Macos, release::ReleaseOs::Windows]);
        for value in ["linux", "", "macos,linux"] {
            assert!(
                Cli::try_parse_from(["misty", "release", "start", "0.1.0", "--os", value]).is_err()
            );
        }
        for flag in ["--no-macos", "--no-windows"] {
            assert!(Cli::try_parse_from(["misty", "release", "start", "0.1.0", flag]).is_err());
        }
    }

    #[test]
    fn destructive_flags_are_never_implicit() {
        let down = Cli::try_parse_from(["misty", "server", "down"]).unwrap();
        let Command::Server(server) = down.command else {
            panic!("expected server command");
        };
        assert!(matches!(
            server.command,
            ServerCommand::Down { volumes: false }
        ));

        let cors = Cli::try_parse_from(["misty", "server", "r2", "configure-cors"]).unwrap();
        let Command::Server(server) = cors.command else {
            panic!("expected server command");
        };
        assert!(matches!(
            server.command,
            ServerCommand::R2 {
                command: R2Command::ConfigureCors { apply: false }
            }
        ));
    }

    #[test]
    fn rejects_the_retired_standalone_file_manager_command() {
        assert!(Cli::try_parse_from(["misty", "file-manager"]).is_err());
    }

    #[test]
    fn docs_requires_an_explicit_subcommand() {
        assert!(Cli::try_parse_from(["misty", "docs"]).is_err());
    }
}
