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
    ];
    assert!(validate_health(&rows).is_ok());
    assert!(validate_health(&rows[..2]).is_err());
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
fn r2_origins_are_narrow() {
    assert!(validate_r2_origin("https://mistysys.com").is_ok());
    assert!(validate_r2_origin("tauri://localhost").is_ok());
    assert!(validate_r2_origin("https://mistysys.com/path").is_err());
    assert!(validate_r2_origin("https://*.mistysys.com").is_err());
}
