use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Parser, Subcommand, ValueEnum};

use crate::{
    checks, config::Settings, desktop, environment, home, mobile, official_apps, release, server,
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
    /// Install the locked workspace dependencies and build the public SDK.
    Setup,
    /// Build or validate the public SDK and contracts.
    Sdk {
        #[command(subcommand)]
        command: SdkCommand,
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
    Doctor,
    /// Create and validate private runtime environments.
    Env(Env),
    /// Generate and validate the cross-platform ~/.misty home.
    Home(Home),
    Check(Check),
    /// Build and package Apps maintained in the Misty repositories.
    Apps(Apps),
    Desktop(Desktop),
    /// Develop and package the Apple mobile app.
    Mobile(Mobile),
    /// Run the documentation site.
    Docs(Docs),
    /// Run the public website.
    Website(Website),
    Server(Server),
    Release(Release),
}

#[derive(Debug, Subcommand)]
enum SdkCommand {
    Build,
    Check,
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
        /// Existing Misty home whose portable plugins should be copied.
        #[arg(long)]
        source: Option<PathBuf>,
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
    /// Split legacy private files into the scoped layout.
    Migrate,
    /// Create missing private files without overwriting configured values.
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
    Sdk,
    Tasks,
    App,
    Server,
    Website,
    Extensions,
    Cli,
    All,
}

#[derive(Debug, Args)]
struct Desktop {
    #[command(subcommand)]
    command: DesktopCommand,
}

#[derive(Debug, Args)]
struct Apps {
    #[command(subcommand)]
    command: AppsCommand,
}

#[derive(Debug, Subcommand)]
enum AppsCommand {
    /// Compile selected downloadable apps (all apps when omitted).
    Build {
        apps: Vec<String>,
        #[arg(long)]
        desktop_only: bool,
    },
    /// Sign and package existing app builds for local development.
    Package { apps: Vec<String> },
    /// Contributor commands for Misty's first-party Apps.
    Official(OfficialApps),
}

#[derive(Debug, Args)]
struct OfficialApps {
    #[command(subcommand)]
    command: OfficialAppsCommand,
}

#[derive(Debug, Subcommand)]
enum OfficialAppsCommand {
    /// Compile, sign for development, validate, and sync all official Apps.
    Build,
}

#[derive(Debug, Args)]
struct Mobile {
    #[command(subcommand)]
    command: MobileCommand,
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
enum MobileCommand {
    /// Validate Xcode, Rust targets, Tauri, and the tracked Apple project.
    Doctor,
    /// List the iPhones, iPads, and simulators visible to Xcode.
    Devices,
    /// Open the generated Apple project in Xcode.
    Open,
    /// Install Rust targets and initialize Tauri's iOS project when absent.
    Setup {
        /// Refresh CocoaPods and other generated Apple dependencies.
        #[arg(long)]
        reinstall_deps: bool,
        /// Do not let Tauri install missing Rust iOS targets.
        #[arg(long)]
        skip_targets_install: bool,
    },
    /// Run the iOS app with development hot reload.
    Dev {
        /// Xcode device name, such as "My iPhone".
        #[arg(long)]
        device: Option<String>,
        /// Open the generated project in Xcode instead of launching directly.
        #[arg(long)]
        open: bool,
        /// Use a particular local address for the mobile development server.
        #[arg(long)]
        host: Option<String>,
        /// Compile the Rust application in release mode.
        #[arg(long)]
        release: bool,
        /// Disable Rust source watching.
        #[arg(long)]
        no_watch: bool,
    },
    /// Run the built frontend on an iOS device without a development server.
    Run {
        /// Xcode device name, such as "My iPhone".
        #[arg(long)]
        device: Option<String>,
        /// Open the generated project in Xcode instead of launching directly.
        #[arg(long)]
        open: bool,
        /// Compile the Rust application in release mode.
        #[arg(long)]
        release: bool,
        /// Disable Rust source watching.
        #[arg(long)]
        no_watch: bool,
    },
    /// Build an iOS device or simulator application.
    Build {
        /// Apple architecture to build.
        #[arg(long, value_enum, default_value = "device")]
        target: mobile::BuildTarget,
        /// Produce a debug build.
        #[arg(long)]
        debug: bool,
        /// Open the generated project in Xcode.
        #[arg(long)]
        open: bool,
        /// Skip code signing (useful for simulator and CI verification).
        #[arg(long)]
        no_sign: bool,
        /// App Store build number to embed.
        #[arg(long)]
        build_number: Option<String>,
        /// Export a signed archive for the selected distribution method.
        #[arg(long, value_enum)]
        export_method: Option<mobile::ExportMethod>,
        /// Disable interactive prompts.
        #[arg(long)]
        ci: bool,
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
    Up {
        #[arg(long)]
        detach: bool,
        #[arg(long)]
        no_build: bool,
    },
    Url,
    Down {
        #[arg(long)]
        volumes: bool,
    },
    Logs,
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
    Start {
        version: String,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        no_macos: bool,
        #[arg(long)]
        no_windows: bool,
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
    load_command_environment(&arguments.command, &settings)?;
    match arguments.command {
        Command::Setup => crate::development::setup(&settings.workspace),
        Command::Sdk { command } => crate::development::sdk(
            &settings.workspace,
            match command {
                SdkCommand::Build => "build",
                SdkCommand::Check => "check",
            },
        ),
        Command::Tasks => crate::development::tasks(&settings.workspace),
        Command::Task { name, arguments } => {
            crate::development::task(&settings.workspace, &name, &arguments)
        }
        Command::Configure(command) => {
            let path = Settings::save_workspace(&command.workspace)?;
            println!("Saved workspace configuration to {}", path.display());
            Ok(())
        }
        Command::Doctor => doctor(&settings),
        Command::Env(command) => match command.command {
            EnvCommand::Migrate => environment::migrate(&settings.workspace),
            EnvCommand::Init { target } => {
                environment::init(&settings.workspace, target)?;
                if target == environment::Target::Dev {
                    server::initialize_development_secrets(&settings.workspace)?;
                }
                Ok(())
            }
            EnvCommand::Check { target } => environment::check(&settings.workspace, target),
            EnvCommand::Status { target } => environment::status(&settings.workspace, target),
        },
        Command::Home(command) => match command.command {
            HomeCommand::Generate {
                destination,
                source,
            } => home::generate(destination.as_deref(), source.as_deref()),
            HomeCommand::Check { path } => home::check(path.as_deref()),
        },
        Command::Check(command) => match command.target {
            CheckTarget::App => checks::app(&settings.workspace),
            CheckTarget::Sdk => crate::development::sdk(&settings.workspace, "check"),
            CheckTarget::Tasks => crate::process::CommandSpec::new(crate::process::npm())
                .args(["run", "test:tasks"])
                .run(&settings.workspace.misty),
            CheckTarget::Server => checks::server(&settings.workspace),
            CheckTarget::Website => checks::website(&settings.workspace),
            CheckTarget::Extensions => checks::extensions(&settings.workspace),
            CheckTarget::Cli => checks::cli(&settings.workspace),
            CheckTarget::All => {
                checks::app(&settings.workspace)?;
                checks::server(&settings.workspace)?;
                checks::website(&settings.workspace)?;
                checks::extensions(&settings.workspace)?;
                checks::cli(&settings.workspace)
            }
        },
        Command::Apps(command) => match command.command {
            AppsCommand::Build { apps, desktop_only } => {
                let mut args = apps;
                if desktop_only {
                    args.push("--desktop-only".into());
                }
                crate::development::task(&settings.workspace, "build-official-app-packages", &args)
            }
            AppsCommand::Package { apps } => {
                crate::development::task(&settings.workspace, "apps/build-official-apps", &apps)
            }
            AppsCommand::Official(command) => match command.command {
                OfficialAppsCommand::Build => {
                    official_apps::build(&settings.workspace)?;
                    Ok(())
                }
            },
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
        Command::Mobile(command) => match command.command {
            MobileCommand::Doctor => mobile::doctor(&settings.workspace),
            MobileCommand::Devices => mobile::devices(&settings.workspace),
            MobileCommand::Open => mobile::open(&settings.workspace),
            MobileCommand::Setup {
                reinstall_deps,
                skip_targets_install,
            } => mobile::setup(&settings.workspace, reinstall_deps, skip_targets_install),
            MobileCommand::Dev {
                device,
                open,
                host,
                release,
                no_watch,
            } => mobile::dev(
                &settings.workspace,
                mobile::DevOptions {
                    device: device.as_deref(),
                    open,
                    host: host.as_deref(),
                    release,
                    no_watch,
                },
            ),
            MobileCommand::Run {
                device,
                open,
                release,
                no_watch,
            } => mobile::run(
                &settings.workspace,
                mobile::RunOptions {
                    device: device.as_deref(),
                    open,
                    release,
                    no_watch,
                },
            ),
            MobileCommand::Build {
                target,
                debug,
                open,
                no_sign,
                build_number,
                export_method,
                ci,
            } => mobile::build(
                &settings.workspace,
                mobile::BuildOptions {
                    target,
                    debug,
                    open,
                    no_sign,
                    build_number: build_number.as_deref(),
                    export_method,
                    ci,
                },
            ),
        },
        Command::Docs(command) => match command.command {
            DocsCommand::Dev => website::docs(&settings.workspace),
            DocsCommand::Build => website::docs_build(&settings.workspace),
        },
        Command::Website(command) => match command.command {
            WebsiteCommand::Dev => website::dev(&settings.workspace),
        },
        Command::Server(command) => match command.command {
            ServerCommand::Up { detach, no_build } => {
                server::up(&settings.workspace, detach, !no_build)
            }
            ServerCommand::Url => server::url(&settings.workspace),
            ServerCommand::Down { volumes } => server::down(&settings.workspace, volumes),
            ServerCommand::Logs => server::logs(&settings.workspace),
            ServerCommand::Prod { command } => match command {
                ProdCommand::Check => server::production_check(&settings.workspace),
                ProdCommand::Up => server::production_up(&settings.workspace),
                ProdCommand::Down { volumes } => {
                    server::production_down(&settings.workspace, volumes)
                }
                ProdCommand::Logs => server::production_logs(&settings.workspace),
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
            ReleaseCommand::Start {
                version,
                dry_run,
                no_macos,
                no_windows,
            } => release::start(&settings.workspace, &version, dry_run, no_macos, no_windows),
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

fn load_command_environment(command: &Command, settings: &Settings) -> Result<()> {
    let files: &[&str] = match command {
        Command::Configure(_)
        | Command::Env(_)
        | Command::Home(_)
        | Command::Setup
        | Command::Sdk { .. }
        | Command::Tasks
        | Command::Task { .. } => &[],
        Command::Doctor | Command::Release(_) => &["common.env", "release.env"],
        Command::Desktop(desktop) => match desktop.command {
            DesktopCommand::Build => &["common.env", "release.env"],
            _ => &["common.env"],
        },
        Command::Mobile(mobile) => match mobile.command {
            MobileCommand::Build { .. } => &["common.env", "release.env"],
            _ => &["common.env"],
        },
        Command::Server(server) => match &server.command {
            ServerCommand::Worker { .. } | ServerCommand::R2 { .. } => {
                &["common.env", "cloudflare.env"]
            }
            _ => &["common.env"],
        },
        Command::Check(_) | Command::Apps(_) | Command::Docs(_) | Command::Website(_) => {
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
            vec!["misty", "env", "init", "dev"],
            vec!["misty", "env", "migrate"],
            vec!["misty", "env", "check", "prod"],
            vec!["misty", "env", "status", "dev"],
            vec!["misty", "home", "generate"],
            vec![
                "misty",
                "home",
                "generate",
                "--destination",
                "/tmp/.misty",
                "--source",
                "/tmp/source/.misty",
            ],
            vec!["misty", "home", "check"],
            vec!["misty", "check", "all"],
            vec!["misty", "check", "app"],
            vec!["misty", "check", "server"],
            vec!["misty", "check", "website"],
            vec!["misty", "check", "extensions"],
            vec!["misty", "check", "cli"],
            vec!["misty", "apps", "official", "build"],
            vec!["misty", "desktop", "dev", "--profile", "owner"],
            vec!["misty", "desktop", "build"],
            vec!["misty", "desktop", "clean", "--apply"],
            vec!["misty", "desktop", "icons", "sync"],
            vec!["misty", "mobile", "doctor"],
            vec!["misty", "mobile", "devices"],
            vec!["misty", "mobile", "open"],
            vec!["misty", "mobile", "setup", "--reinstall-deps"],
            vec![
                "misty",
                "mobile",
                "dev",
                "--device",
                "Matthew's iPhone",
                "--host",
                "192.168.1.20",
            ],
            vec!["misty", "mobile", "dev", "--open"],
            vec!["misty", "mobile", "run", "--release"],
            vec![
                "misty",
                "mobile",
                "build",
                "--target",
                "simulator",
                "--no-sign",
            ],
            vec![
                "misty",
                "mobile",
                "build",
                "--build-number",
                "42",
                "--export-method",
                "app-store-connect",
                "--ci",
            ],
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
            vec!["misty", "release", "start", "0.1.0", "--no-windows"],
            vec!["misty", "release", "start", "0.1.0", "--no-macos"],
            vec!["misty", "release", "verify", "0.1.0", "--dry-run"],
        ] {
            Cli::try_parse_from(arguments).unwrap();
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

    #[test]
    fn mobile_requires_an_explicit_subcommand() {
        assert!(Cli::try_parse_from(["misty", "mobile"]).is_err());
    }
}
