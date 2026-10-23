use super::*;

#[test]
fn parses_the_stable_command_surface() {
    for arguments in [
        vec!["misty", "doctor"],
        vec!["misty", "tool", "vite", "build", "--mode", "desktop"],
        vec!["misty", "env", "init", "dev"],
        vec!["misty", "env", "check", "prod"],
        vec!["misty", "env", "status", "dev"],
        vec!["misty", "home", "generate"],
        vec!["misty", "home", "generate", "--destination", "/tmp/.misty"],
        vec!["misty", "home", "check"],
        vec!["misty", "check", "all"],
        vec!["misty", "check", "app"],
        vec!["misty", "check", "server"],
        vec!["misty", "check", "website"],
        vec!["misty", "check", "features"],
        vec!["misty", "check", "cli"],
        vec!["misty", "desktop", "dev", "--profile", "owner"],
        vec!["misty", "desktop", "build"],
        vec!["misty", "desktop", "clean", "--apply"],
        vec!["misty", "desktop", "icons", "sync"],
        vec!["misty", "docs", "dev"],
        vec!["misty", "website", "dev"],
        vec!["misty", "server", "up", "--no-build"],
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
fn docs_requires_an_explicit_subcommand() {
    assert!(Cli::try_parse_from(["misty", "docs"]).is_err());
}
