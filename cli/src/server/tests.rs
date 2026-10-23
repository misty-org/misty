use super::*;

#[test]
fn occupied_port_is_reported_before_startup() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(check_available_port(port).is_err());
    drop(listener);
    assert!(check_available_port(port).is_ok());
}

#[test]
fn health_rejects_failed_migrations_and_unhealthy_services() {
    let mut rows = vec![
        json!({"Service":"postgres","State":"running","Health":"healthy"}),
        json!({"Service":"misty-api","State":"running","Health":"healthy"}),
        json!({"Service":"tunnel","State":"running","Health":"healthy"}),
        json!({"Service":"setup","State":"exited","ExitCode":0}),
        json!({"Service":"agent-runtime","State":"running","Health":"healthy"}),
    ];
    assert!(validate_health(&rows).is_ok());
    assert!(validate_health(&rows[..4]).is_err());
    rows[3]["ExitCode"] = json!(1);
    assert!(validate_health(&rows).is_err());
    rows[3]["ExitCode"] = json!(0);
    rows[1]["Health"] = json!("unhealthy");
    assert!(validate_health(&rows).is_err());
    assert!(validate_health(&[]).is_err());
}

#[test]
fn development_commands_select_the_explicit_compose_file() {
    let up = development_up_command(true).display();
    assert!(!up.contains("--env-file"));
    assert!(up.ends_with("--file compose.dev.yml up --build --remove-orphans --detach"));
    let up_without_build = development_up_command(false).display();
    assert!(up_without_build.ends_with("--file compose.dev.yml up --remove-orphans --detach"));
    let down = development_down_command(true).display();
    assert!(down.ends_with("--file compose.dev.yml down --volumes --remove-orphans"));
    let logs = development_compose().args(["logs", "--follow"]).display();
    assert!(logs.ends_with("--file compose.dev.yml logs --follow"));
    assert!(development_tunnel_connection_command()
        .display()
        .contains("cloudflared_tunnel_ha_connections"));
    assert!(!development_tunnel_connection_command()
        .display()
        .contains("tunnel-url"));
}

#[test]
fn development_api_url_uses_the_static_tunnel_hostname_by_default() {
    assert!(env::var("MISTY_DEV_API_TUNNEL_HOSTNAME").is_err());
    assert_eq!(development_tunnel_hostname(), "");
}

#[test]
fn environment_values_find_only_exact_active_keys() {
    let contents = "# JOURNAL_COLLAB_ROOM_SALT=ignored\n\
                    OTHER_JOURNAL_COLLAB_ROOM_SALT=ignored\n\
                    JOURNAL_COLLAB_ROOM_SALT=kept\n";
    assert_eq!(
        environment_values(contents, "JOURNAL_COLLAB_ROOM_SALT"),
        vec!["kept"]
    );
    assert_eq!(
        environment_values(
            "JOURNAL_COLLAB_ROOM_SALT=\"quoted\"\n",
            "JOURNAL_COLLAB_ROOM_SALT"
        ),
        vec!["quoted"]
    );
}

#[test]
fn development_server_configures_connected_devices_once() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(".env.dev");
    fs::write(&path, "DB_NAME=misty\n").unwrap();

    assert!(ensure_connected_devices_development_config(&path).unwrap());
    let first = fs::read_to_string(&path).unwrap();
    assert_eq!(
        environment_values(&first, DEVICE_TICKET_PRIVATE_KEY).len(),
        1
    );
    assert_eq!(environment_values(&first, DEVICE_PAIRING_PEPPER).len(), 1);

    assert!(!ensure_connected_devices_development_config(&path).unwrap());
    assert_eq!(fs::read_to_string(&path).unwrap(), first);
}

#[test]
fn production_generation_replaces_only_placeholders_and_keeps_room_salt() {
    let room_salt = STANDARD.encode([7_u8; 32]);
    let contents = format!(
        "MISTY_ENVIRONMENT=production\n\
         {ROOM_SALT}={room_salt}\n\
         {TICKET_PRIVATE_KEY}=<replace-private>\n\
         {CONTROL_SECRET}=replace-with-control\n\
         {PROJECTION_SECRET}=replace-me\n"
    );
    let secrets = JournalSecrets {
        private: "private".to_owned(),
        public: "public".to_owned(),
        control: "control".to_owned(),
        projection: "projection".to_owned(),
    };
    let updated = replace_production_secret_placeholders(
        &contents,
        std::path::Path::new(".env.prod"),
        &secrets,
    )
    .unwrap();
    assert!(updated.contains(&format!("{ROOM_SALT}={room_salt}\n")));
    assert!(updated.contains(&format!("{TICKET_PRIVATE_KEY}=private\n")));
    assert!(updated.contains(&format!("{CONTROL_SECRET}=control\n")));
    assert!(updated.contains(&format!("{PROJECTION_SECRET}=projection\n")));
}

#[test]
fn production_generation_refuses_existing_secrets() {
    let contents = format!(
        "{TICKET_PRIVATE_KEY}=already-configured\n\
         {CONTROL_SECRET}=replace-me\n\
         {PROJECTION_SECRET}=replace-me\n"
    );
    let secrets = JournalSecrets {
        private: "private".to_owned(),
        public: "public".to_owned(),
        control: "control".to_owned(),
        projection: "projection".to_owned(),
    };
    assert!(replace_production_secret_placeholders(
        &contents,
        std::path::Path::new(".env.prod"),
        &secrets
    )
    .is_err());
}

#[test]
fn production_generation_writes_a_matched_private_bundle_once() {
    let temporary = tempfile::tempdir().unwrap();
    let server = temporary.path().join("misty-server");
    fs::create_dir_all(&server).unwrap();
    let room_salt = STANDARD.encode([9_u8; 32]);
    let production_path = server.join(".env/prod/crypto/journal.env");
    fs::create_dir_all(production_path.parent().unwrap()).unwrap();
    write_private(
        &production_path,
        format!(
            "MISTY_ENVIRONMENT=production\n\
             {ROOM_SALT}={room_salt}\n\
             {TICKET_PRIVATE_KEY}=<replace-private>\n\
             {CONTROL_SECRET}=replace-with-control\n\
             {PROJECTION_SECRET}=replace-with-projection\n"
        )
        .as_bytes(),
    )
    .unwrap();
    let workspace = Workspace {
        root: temporary.path().to_path_buf(),
        misty: temporary.path().join("app"),
        server: server.clone(),
        website: temporary.path().join("website"),
        features: temporary.path().join("src/features"),
        cli: temporary.path().join("cli"),
    };

    generate_production_worker_secrets(&workspace).unwrap();

    let production = fs::read_to_string(&production_path).unwrap();
    let worker =
        fs::read_to_string(server.join("apps/journal-collab/.secrets/worker.prod.env")).unwrap();
    assert!(production.contains(&format!("{ROOM_SALT}={room_salt}\n")));
    assert!(!production.contains("replace-"));
    assert!(!worker.contains(TICKET_PRIVATE_KEY));
    assert!(worker.contains(TICKET_PUBLIC_KEY));
    for name in [CONTROL_SECRET, PROJECTION_SECRET] {
        assert_eq!(
            environment_values(&production, name),
            environment_values(&worker, name)
        );
    }
    assert!(generate_production_worker_secrets(&workspace).is_err());
    let production_values = read_environment(&production_path).unwrap();
    let worker_path = server.join("apps/journal-collab/.secrets/worker.prod.env");
    let worker_values = read_environment(&worker_path).unwrap();
    validate_production_worker_bundle(
        &production_values,
        &production_path,
        &worker_values,
        &worker_path,
    )
    .unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&production_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(server.join("apps/journal-collab/.secrets/worker.prod.env"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn production_deploy_command_never_displays_the_api_token() {
    let command = production_worker_deploy_command(
        Path::new("/workspace/wrangler"),
        "cloudflare-secret-token",
        "misty-journal-collab",
        "https://mistysys.com/api",
        Path::new("/workspace/worker.prod.env"),
        true,
        Some(Path::new("/tmp/output")),
    );
    let display = command.display();
    assert!(!display.contains("cloudflare-secret-token"));
    assert!(display.contains("--dry-run"));
    assert!(display.contains("misty-journal-collab"));
}

#[test]
fn r2_origins_are_narrow() {
    assert!(validate_r2_origin("https://mistysys.com").is_ok());
    assert!(validate_r2_origin("tauri://localhost").is_ok());
    assert!(validate_r2_origin("https://mistysys.com/path").is_err());
    assert!(validate_r2_origin("https://*.mistysys.com").is_err());
}
