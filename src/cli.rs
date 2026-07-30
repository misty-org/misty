use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::{checks, config::Settings, desktop, release, server};

#[derive(Debug, Parser)]
#[command(name = "misty-cli", version, about)]
pub struct Cli {
    #[arg(long, global = true)]
    pub workspace: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Configure(Configure),
    Doctor,
    Check(Check),
    Desktop(Desktop),
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

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CheckTarget {
    Misty,
    Server,
    All,
}

#[derive(Debug, Args)]
struct Desktop {
    #[command(subcommand)]
    command: DesktopCommand,
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
    Windows {
        #[command(subcommand)]
        command: WindowsCommand,
    },
}

#[derive(Debug, Subcommand)]
enum IconCommand {
    Sync {
        #[arg(long)]
        source: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
enum WindowsCommand {
    StageAssets {
        #[arg(long)]
        source: Option<PathBuf>,
        #[arg(long)]
        destination: Option<PathBuf>,
    },
}

#[derive(Debug, Args)]
struct Server {
    #[command(subcommand)]
    command: ServerCommand,
}

#[derive(Debug, Subcommand)]
enum ServerCommand {
    Up {
        #[arg(long)]
        detach: bool,
        #[arg(long)]
        no_build: bool,
    },
    Down {
        #[arg(long)]
        volumes: bool,
    },
    Logs,
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
enum ImageCommand {
    Build {
        #[arg(long)]
        tag: String,
    },
}

#[derive(Debug, Subcommand)]
enum WorkerCommand {
    GenerateSecrets,
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
    Start {
        version: String,
        #[arg(long)]
        dry_run: bool,
    },
    Build {
        version: String,
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
    match arguments.command {
        Command::Configure(command) => {
            let path = Settings::save_workspace(&command.workspace)?;
            println!("Saved workspace configuration to {}", path.display());
            Ok(())
        }
        Command::Doctor => doctor(&settings),
        Command::Check(command) => match command.target {
            CheckTarget::Misty => checks::misty(&settings.workspace),
            CheckTarget::Server => checks::server(&settings.workspace),
            CheckTarget::All => {
                checks::misty(&settings.workspace)?;
                checks::server(&settings.workspace)
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
            DesktopCommand::Windows { command } => match command {
                WindowsCommand::StageAssets {
                    source,
                    destination,
                } => desktop::stage_windows_assets(
                    &settings.workspace,
                    source.as_deref(),
                    destination.as_deref(),
                ),
            },
        },
        Command::Server(command) => match command.command {
            ServerCommand::Up { detach, no_build } => {
                server::up(&settings.workspace, detach, !no_build)
            }
            ServerCommand::Down { volumes } => server::down(&settings.workspace, volumes),
            ServerCommand::Logs => server::logs(&settings.workspace),
            ServerCommand::Image { command } => match command {
                ImageCommand::Build { tag } => server::build_image(&settings.workspace, &tag),
            },
            ServerCommand::Worker { command } => match command {
                WorkerCommand::GenerateSecrets => {
                    server::generate_worker_secrets(&settings.workspace)
                }
            },
            ServerCommand::R2 { command } => match command {
                R2Command::ConfigureCors { apply } => {
                    server::configure_r2_cors(&settings.workspace, apply)
                }
            },
        },
        Command::Release(command) => match command.command {
            ReleaseCommand::Start { version, dry_run } => {
                release::start(&settings.workspace, &version, dry_run)
            }
            ReleaseCommand::Build { version, dry_run } => {
                release::build(&settings.workspace, &version, dry_run)
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
    report_release_inputs();
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

fn report_release_inputs() {
    let mut names = vec![
        "TAURI_UPDATER_PUBLIC_KEY",
        "TAURI_UPDATER_ENDPOINT",
        "TAURI_CSP_CONNECT_SOURCES",
        "TAURI_CSP_IMAGE_SOURCES",
        "TAURI_SIGNING_PRIVATE_KEY",
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    ];
    if cfg!(target_os = "macos") {
        names.extend(["APPLE_SIGNING_IDENTITY", "MISTY_NOTARY_KEYCHAIN_PROFILE"]);
    }
    let missing = names
        .into_iter()
        .filter(|name| {
            std::env::var(name)
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        println!("Release inputs     ready");
    } else {
        println!("Release inputs     missing: {}", missing.join(", "));
    }
}

fn report_repository_status(settings: &Settings) -> Result<()> {
    for (name, path) in [
        ("misty", &settings.workspace.misty),
        ("server", &settings.workspace.server),
        ("cli", &settings.workspace.cli),
    ] {
        let status = crate::process::CommandSpec::new("git")
            .args(["status", "--porcelain"])
            .capture(path)?;
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
            vec!["misty-cli", "doctor"],
            vec!["misty-cli", "check", "all"],
            vec!["misty-cli", "desktop", "dev", "--profile", "owner"],
            vec!["misty-cli", "desktop", "clean", "--apply"],
            vec!["misty-cli", "desktop", "icons", "sync"],
            vec!["misty-cli", "desktop", "windows", "stage-assets"],
            vec!["misty-cli", "server", "up", "--detach", "--no-build"],
            vec!["misty-cli", "server", "down", "--volumes"],
            vec!["misty-cli", "server", "image", "build", "--tag", "local"],
            vec!["misty-cli", "server", "worker", "generate-secrets"],
            vec!["misty-cli", "server", "r2", "configure-cors", "--apply"],
            vec!["misty-cli", "release", "verify", "0.1.0", "--dry-run"],
        ] {
            Cli::try_parse_from(arguments).unwrap();
        }
    }

    #[test]
    fn destructive_flags_are_never_implicit() {
        let down = Cli::try_parse_from(["misty-cli", "server", "down"]).unwrap();
        let Command::Server(server) = down.command else {
            panic!("expected server command");
        };
        assert!(matches!(
            server.command,
            ServerCommand::Down { volumes: false }
        ));

        let cors = Cli::try_parse_from(["misty-cli", "server", "r2", "configure-cors"]).unwrap();
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
}
