use super::*;

#[test]
fn parses_the_stable_command_surface() {
    for arguments in [
        vec!["misty"],
        vec!["misty", "build"],
        vec!["misty", "release"],
        vec!["misty", "release", "--dry-run"],
        vec!["misty", "doctor"],
        vec!["misty", "env", "init"],
        vec!["misty", "env", "status"],
        vec!["misty", "home", "generate"],
        vec!["misty", "home", "generate", "--destination", "/tmp/.misty"],
        vec!["misty", "home", "check"],
        vec!["misty", "check", "all"],
        vec!["misty", "check", "app"],
        vec!["misty", "check", "server"],
        vec!["misty", "check", "website"],
        vec!["misty", "check", "features"],
        vec!["misty", "check", "cli"],
        vec!["misty", "desktop", "dev", "--route", "/spaces/demo"],
        vec!["misty", "desktop", "clean", "--apply"],
        vec!["misty", "desktop", "icons", "sync"],
        vec!["misty", "docs", "dev"],
        vec!["misty", "website", "dev"],
        vec!["misty", "server", "up", "--no-build"],
        vec!["misty", "server", "url"],
        vec!["misty", "server", "down", "--volumes"],
        vec!["misty", "server", "worker", "generate-secrets"],
        vec!["misty", "server", "r2", "configure-cors", "--apply"],
    ] {
        Cli::try_parse_from(arguments).unwrap();
    }
    // Deployment is misty-server/compose.yml's job, never the CLI's.
    for arguments in [
        vec!["misty", "env", "init", "prod"],
        vec!["misty", "server", "prod", "up"],
        vec!["misty", "server", "staging", "up"],
        vec!["misty", "server", "release", "0.1.0"],
        vec![
            "misty",
            "server",
            "worker",
            "deploy",
            "--target",
            "production",
        ],
        vec!["misty", "setup", "cloudflare", "--target", "prod"],
        // Releases only go through the guided flow.
        vec!["misty", "release", "publish", "0.1.0"],
    ] {
        assert!(Cli::try_parse_from(arguments).is_err());
    }
}

#[test]
fn destructive_flags_are_never_implicit() {
    let down = Cli::try_parse_from(["misty", "server", "down"]).unwrap();
    let Some(Command::Server(server)) = down.command else {
        panic!("expected server command");
    };
    assert!(matches!(
        server.command,
        ServerCommand::Down { volumes: false }
    ));

    let cors = Cli::try_parse_from(["misty", "server", "r2", "configure-cors"]).unwrap();
    let Some(Command::Server(server)) = cors.command else {
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
fn docs_requires_an_explicit_subcommand() {
    assert!(Cli::try_parse_from(["misty", "docs"]).is_err());
}
