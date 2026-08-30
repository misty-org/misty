use super::*;

#[test]
fn parses_only_safe_non_secret_host_metadata() {
    let items = parse_ssh_config(
        r#"
            Host *
              AddKeysToAgent yes
            Host production prod
              HostName prod.example.com
              User deploy
              Port 2222
              IdentityFile ~/.ssh/id_ed25519
            Host "unsafe;touch-pwned"
              HostName bad.example.com
            Host wildcard-*
              HostName ignored.example.com
        "#,
        Path::new("/device/.ssh/config"),
    );
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].host, "prod.example.com");
    assert_eq!(items[0].user.as_deref(), Some("deploy"));
    assert_eq!(items[0].port, 2222);
    let serialized = serde_json::to_string(&items).expect("serialize");
    assert!(!serialized.contains("IdentityFile"));
    assert!(!serialized.contains("id_ed25519"));
    assert!(items.iter().all(|item| item.device_local));
    assert!(items.iter().all(|item| item.agent_tools == "device_local"));
}

fn sample_environment() -> SshEnvironment {
    SshEnvironment {
        id: "production".to_owned(),
        label: "production".to_owned(),
        host: "prod.example.com".to_owned(),
        user: Some("deploy".to_owned()),
        port: 22,
        config_path: "/device/.ssh/config".to_owned(),
        device_local: true,
        agent_tools: "device_local".to_owned(),
    }
}

#[test]
fn ssh_argv_is_strict_and_never_invokes_a_shell() {
    let argv = ssh_argv(&sample_environment(), Path::new("/device/.ssh/known_hosts"));
    assert_eq!(argv.last().map(String::as_str), Some("production"));
    assert!(argv.contains(&"StrictHostKeyChecking=yes".to_owned()));
    assert!(argv.contains(&"UpdateHostKeys=no".to_owned()));
    assert!(!argv
        .iter()
        .any(|argument| argument == "sh" || argument == "-c"));
    assert!(!safe_ssh_alias("prod; rm -rf x"));
    assert!(!safe_ssh_alias("-oProxyCommand=bad"));
}

#[test]
fn host_key_lines_reject_comments_and_malformed_output() {
    let lines = public_key_lines(
        "# scan comment\nexample.com ssh-ed25519 AAAATEST\nmalformed\nexample.com command AAAA\n",
    );
    assert_eq!(lines, vec!["example.com ssh-ed25519 AAAATEST"]);
    let mut environment = sample_environment();
    environment.id = "prod".to_owned();
    environment.port = 2200;
    assert_eq!(known_host_lookup(&environment), "[prod.example.com]:2200");
}
