//! Commands that outlive, crash or time out: nothing they start may keep running.
use super::*;

#[tokio::test]
async fn commands_have_no_network_and_a_clean_environment() {
    let scene = scene();
    // The only way out left to a shell is its own network redirect.
    let network = shell(&scene, "chat", "echo hi > /dev/tcp/1.1.1.1/80", None).await;
    assert_ne!(network.exit_code, Some(0), "{}", network.stdout);
    let missing = shell(&scene, "chat", "curl -sS https://example.com", None).await;
    assert_eq!(
        missing.exit_code,
        Some(127),
        "there's no tool for it either"
    );
    std::env::set_var("MISTY_TEST_SECRET_VALUE", "visible");
    let environment = shell(&scene, "chat", "env", None).await;
    assert!(!environment.stdout.contains("MISTY_TEST_SECRET_VALUE"));
    let names: Vec<&str> = environment
        .stdout
        .lines()
        .filter_map(|line| line.split('=').next())
        // The system adds its own text encoding to every process.
        .filter(|name| {
            !matches!(
                *name,
                "PWD" | "SHLVL" | "_" | "OLDPWD" | "__CF_USER_TEXT_ENCODING"
            )
        })
        .collect();
    assert_eq!(names.len(), 5, "only what Misty set: {names:?}");
}

#[tokio::test]
async fn nothing_it_started_outlives_a_timeout() {
    let scene = scene();
    let outcome = run(
        &scene.misty,
        ShellRequest {
            workspace_key: "chat".into(),
            // brush leaves `$!` empty, so the background command says who it is itself.
            command: "sh -c 'echo $$ > background.pid; exec sleep 300' & wait".into(),
            timeout: Some(Duration::from_secs(2)),
            folder: None,
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await
    .unwrap();
    assert!(outcome.timed_out);
    assert_eq!(outcome.exit_code, None);
    let workspace = workspace::prepare(&scene.misty, "chat").unwrap();
    let pid: i32 = fs::read_to_string(workspace.join("background.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "what it left in the background was stopped too"
    );
}

/// Not a test of its own: `a_crash_stops_running_commands` runs this in a second process and kills
/// that process, which is the only honest way to see what a crash leaves behind.
#[tokio::test]
#[ignore = "started by a_crash_stops_running_commands"]
async fn crash_victim() {
    let Ok(misty) = std::env::var("MISTY_SHELL_CRASH_HOME") else {
        return;
    };
    let _ = run(
        Path::new(&misty),
        ShellRequest {
            workspace_key: "chat".into(),
            command:
                "sh -c 'echo $$ > background.pid; exec sleep 300' & echo $$ > leader.pid; wait"
                    .into(),
            timeout: Some(Duration::from_secs(300)),
            folder: None,
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await;
}

fn read_pid(path: &Path) -> Option<i32> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

#[test]
fn a_crash_stops_running_commands() {
    let scene = scene();
    let workspace = workspace::prepare(&scene.misty, "chat").unwrap();
    // Test names leave out the crate, which `module_path!` starts with.
    let module = module_path!().split_once("::").unwrap().1;
    let mut victim = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &format!("{module}::crash_victim"), "--ignored"])
        .env("MISTY_SHELL_CRASH_HOME", &scene.misty)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();

    let started = std::time::Instant::now();
    let (leader, background) = loop {
        if let (Some(leader), Some(background)) = (
            read_pid(&workspace.join("leader.pid")),
            read_pid(&workspace.join("background.pid")),
        ) {
            break (leader, background);
        }
        assert!(
            started.elapsed() < Duration::from_secs(60),
            "the command never started"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    let alive = |pid: i32| unsafe { libc::kill(pid, 0) == 0 };
    assert!(
        alive(leader) && alive(background),
        "both run until the crash"
    );

    victim.kill().unwrap();
    victim.wait().unwrap();

    let crashed = std::time::Instant::now();
    while (alive(leader) || alive(background)) && crashed.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(!alive(leader), "the command stopped with the app");
    assert!(!alive(background), "so did what it left in the background");
}
