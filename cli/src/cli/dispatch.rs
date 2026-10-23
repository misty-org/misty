//! Runs a parsed command after loading the environment files it needs.

use super::*;

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
        Command::Tasks => crate::tasks::list(&settings.workspace),
        Command::Task { name, arguments } => {
            crate::tasks::run(&settings.workspace, &name, &arguments)
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
            EnvCommand::Init { target } => {
                environment::init(&settings.workspace, target)?;
                match target {
                    environment::Target::Dev => {
                        server::initialize_development_secrets(&settings.workspace)
                    }
                    environment::Target::Prod => {
                        deploy::initialize_production_secrets(&settings.workspace)
                    }
                    environment::Target::Staging => {
                        deploy::initialize_staging_secrets(&settings.workspace)
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
            CheckTarget::Scripts => crate::process::CommandSpec::new(crate::process::npm())
                .args(["run", "test:scripts"])
                .run(&settings.workspace.misty),
            CheckTarget::Server => checks::server(&settings.workspace),
            CheckTarget::GoSizes => checks::go_file_sizes(&settings.workspace.server),
            CheckTarget::Website => checks::website(&settings.workspace),
            CheckTarget::Features => checks::features(&settings.workspace),
            CheckTarget::Cli => checks::cli(&settings.workspace),
            CheckTarget::All => {
                checks::app(&settings.workspace)?;
                crate::process::CommandSpec::new(crate::process::npm())
                    .args(["run", "test:scripts"])
                    .run(&settings.workspace.misty)?;
                checks::server(&settings.workspace)?;
                checks::website(&settings.workspace)?;
                checks::features(&settings.workspace)?;
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
                no_build,
                verbose,
                gui,
            } => {
                server::up(&settings.workspace, !no_build, verbose)?;
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
            ServerCommand::Release { version } => server::release(&settings.workspace, &version),
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
            ServerCommand::Staging { command } => match command {
                StagingCommand::Check => server::staging_check(&settings.workspace),
                StagingCommand::Up => server::staging_up(&settings.workspace),
                StagingCommand::Down { volumes } => {
                    server::staging_down(&settings.workspace, volumes)
                }
                StagingCommand::Status => server::staging_status(&settings.workspace),
                StagingCommand::Logs => server::staging_logs(&settings.workspace),
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

pub(super) fn load_command_environment(command: &Command, settings: &Settings) -> Result<()> {
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
            ServerCommand::Staging { .. } => environment::Target::Staging,
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
