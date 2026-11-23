#[test]
fn web_url_with_the_launch_token_is_only_offered_for_our_own_host() {
    let credentials = || {
        Some(super::HostCredentials {
            cookie: "c".into(),
            launch_token: "tok".into(),
        })
    };
    let origin = "http://127.0.0.1:3080";
    assert_eq!(
        super::compose_web_url(origin, true, credentials()).as_deref(),
        Some("http://127.0.0.1:3080/?token=tok")
    );
    assert_eq!(super::compose_web_url(origin, false, credentials()), None);
    assert_eq!(super::compose_web_url(origin, true, None), None);
}

use super::*;

#[test]
fn only_mistys_own_dsh_web_on_that_port_counts_as_its_leftover() {
    let root = "/Users/me/.misty";
    let own = "node /Users/me/.misty/engines/dsh/node_modules/.bin/dsh web --host 127.0.0.1 --port 3080 --no-open";
    assert!(leftover_own_dsh(own, root, 3080));
    let shared =
        "/Users/me/.misty/shared/engines/dsh/node_modules/.bin/dsh web --port=3080 --no-open";
    assert!(leftover_own_dsh(shared, root, 3080));
    assert!(!leftover_own_dsh(own, root, 3081));
    assert!(!leftover_own_dsh(
        "node /Users/me/.misty/engines/dsh/node_modules/.bin/dsh chat --port 3080",
        root,
        3080
    ));
    assert!(!leftover_own_dsh(
        "node /usr/local/bin/dsh web --port 3080",
        root,
        3080
    ));
    assert!(!leftover_own_dsh(
        "node /Users/me/.misty/apps/server.js web --port 3080",
        root,
        3080
    ));
    assert!(!leftover_own_dsh(own, "", 3080));
}
use serde_json::json;

#[test]
fn autostart_needs_the_switch_the_enabled_engine_and_a_binary() {
    assert!(should_autostart(None, true, true));
    assert!(should_autostart(Some(true), true, true));
    assert!(!should_autostart(Some(false), true, true), "switch off");
    assert!(!should_autostart(None, false, true), "engine disabled");
    assert!(!should_autostart(None, true, false), "dsh not installed");
}

#[test]
fn only_our_own_child_is_ever_restarted() {
    let live = ProbeOutcome::Live(json!({}));
    assert_eq!(ensure_action(&live, false), EnsureAction::Adopt);
    assert_eq!(ensure_action(&live, true), EnsureAction::Adopt);
    let down = ProbeOutcome::Down("refused".into());
    assert_eq!(ensure_action(&down, false), EnsureAction::Spawn);
    assert_eq!(ensure_action(&down, true), EnsureAction::RestartOwn);
    for answered in [
        ProbeOutcome::Unauthorized,
        ProbeOutcome::Answered("HTTP 404".into()),
    ] {
        assert!(matches!(
            ensure_action(&answered, false),
            EnsureAction::Occupied(_)
        ));
        assert_eq!(ensure_action(&answered, true), EnsureAction::RestartOwn);
    }
}

struct ScratchHome {
    dir: PathBuf,
    previous: Option<std::ffi::OsString>,
    _lock: parking_lot::MutexGuard<'static, ()>,
}

impl ScratchHome {
    fn new() -> Self {
        let lock = crate::engines::support::paths::HOME_ENV_LOCK.lock();
        let dir = std::env::temp_dir().join(format!("ccgui-dsh-home-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join(".misty").join("shared").join("engines")).unwrap();
        let previous = std::env::var_os("HOME");
        std::env::set_var("HOME", &dir);
        Self {
            dir,
            previous,
            _lock: lock,
        }
    }
}

impl Drop for ScratchHome {
    fn drop(&mut self) {
        match &self.previous {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test]
async fn foreign_listener_is_reported_untouched_and_never_sees_the_cookie() {
    use std::sync::atomic::AtomicUsize;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let _home = ScratchHome::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let saw_cookie = Arc::new(AtomicBool::new(false));
    let (server_hits, server_cookie) = (Arc::clone(&hits), Arc::clone(&saw_cookie));
    let server = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
            server_hits.fetch_add(1, Ordering::SeqCst);
            if request.contains("\r\ncookie:") {
                server_cookie.store(true, Ordering::SeqCst);
            }
            let _ = socket
                .write_all(
                    b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                )
                .await;
        }
    });

    let origin = format!("http://127.0.0.1:{port}");
    store_credentials(
        &origin,
        HostCredentials {
            cookie: "dsh-auth-secret=1".into(),
            launch_token: "token".into(),
        },
    );
    assert!(load_credentials(&origin).is_some(), "credentials staged");
    let settings = AppSettings {
        dsh_host: Some("127.0.0.1".into()),
        dsh_port: Some(port),
        ..AppSettings::default()
    };
    let state = DshHostState::default();

    let error = ensure_host(&state, &settings).await.unwrap_err();
    assert!(error.contains("in use"), "{error}");
    assert!(hits.load(Ordering::SeqCst) > 0, "the port was probed");
    assert!(
        !saw_cookie.load(Ordering::SeqCst),
        "cookie leaked to a foreign listener"
    );
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok(),
        "the foreign listener must keep running"
    );
    assert!(lock(&state.spawned).is_none(), "nothing was spawned");
    server.abort();
}

#[test]
fn host_log_path_is_stamped_under_the_app_home() {
    let home = Path::new("C:\\home\\.ccgui-next");
    let path = HostLog::path_for(home, UNIX_EPOCH + Duration::from_secs(1_791_979_847))
        .expect("a post-epoch clock names a log");
    assert_eq!(path, home.join("host-logs").join("dsh-host-1791979847.log"));
    assert!(HostLog::path_for(home, UNIX_EPOCH - Duration::from_secs(1)).is_none());
}

#[test]
fn host_log_appends_lines_and_rotates_over_budget() {
    let home =
        std::env::temp_dir().join(format!("ccgui-next-host-log-test-{}", uuid::Uuid::new_v4()));
    let now = SystemTime::now();
    let path = HostLog::path_for(&home, now).unwrap();
    let log = HostLog::open(path.clone());
    log.line_capped("first line\n", 32);
    log.line_capped("second line\n", 32);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "first line\nsecond line\n"
    );
    log.line_capped("third line that is long enough\n", 8);
    assert_eq!(
        std::fs::read_to_string(path.with_extension("log.1")).unwrap(),
        "first line\nsecond line\n"
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "third line that is long enough\n"
    );
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn host_log_rotates_once_when_two_drains_hit_the_budget() {
    let home =
        std::env::temp_dir().join(format!("ccgui-next-host-log-race-{}", uuid::Uuid::new_v4()));
    let path = HostLog::path_for(&home, SystemTime::now()).unwrap();
    let log = HostLog::open(path.clone());
    log.line_capped("first line\n", 16);
    log.line_capped("second line\n", 16);
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "first line\nsecond line\n"
    );

    let held = lock(&log.file);
    let entered = Arc::new(AtomicU64::new(0));
    let mut drains = Vec::new();
    for line in ["from stdout\n", "from stderr\n"] {
        let log = Arc::clone(&log);
        let entered = Arc::clone(&entered);
        drains.push(std::thread::spawn(move || {
            entered.fetch_add(1, Ordering::Relaxed);
            log.line_capped(line, 16);
        }));
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while entered.load(Ordering::Relaxed) < 2 && std::time::Instant::now() < deadline {
        std::thread::yield_now();
    }
    std::thread::sleep(Duration::from_millis(200));
    drop(held);
    for drain in drains {
        drain.join().unwrap();
    }

    assert_eq!(
        std::fs::read_to_string(path.with_extension("log.1")).unwrap(),
        "first line\nsecond line\n"
    );
    let fresh = std::fs::read_to_string(&path).unwrap();
    assert!(fresh.contains("from stdout\n"), "{fresh}");
    assert!(fresh.contains("from stderr\n"), "{fresh}");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn host_log_prunes_older_runs_beyond_the_keep_count() {
    let home = std::env::temp_dir().join(format!(
        "ccgui-next-host-log-prune-{}",
        uuid::Uuid::new_v4()
    ));
    let dir = home.join(LOG_DIR);
    std::fs::create_dir_all(&dir).unwrap();
    let epochs: Vec<u64> = (0..LOG_KEEP_RUNS as u64 + 2)
        .map(|index| 1_791_979_000 + index)
        .collect();
    for epoch in &epochs {
        std::fs::write(dir.join(run_log_name(*epoch)), "line\n").unwrap();
    }
    let oldest_rotation = dir.join(format!("{}{LOG_KEEP_SUFFIX}", run_log_name(epochs[0])));
    let newest_rotation = dir.join(format!(
        "{}{LOG_KEEP_SUFFIX}",
        run_log_name(epochs[epochs.len() - 1])
    ));
    std::fs::write(&oldest_rotation, "rotated\n").unwrap();
    std::fs::write(&newest_rotation, "rotated\n").unwrap();
    let stranger = dir.join("notes.txt");
    std::fs::write(&stranger, "keep me\n").unwrap();

    let now = UNIX_EPOCH + Duration::from_secs(1_791_979_847);
    let current = HostLog::for_new_run_at(&home, now).unwrap();

    assert!(current.path.exists());
    assert!(!dir.join(run_log_name(epochs[0])).exists());
    assert!(!oldest_rotation.exists());
    assert!(dir.join(run_log_name(epochs[2])).exists());
    assert!(newest_rotation.exists());
    assert!(stranger.exists());
    let runs = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|entry| run_log_epoch(&entry.file_name().to_string_lossy()).is_some())
        .count();
    assert_eq!(runs, LOG_KEEP_RUNS + 1);
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn first_run_without_a_log_directory_still_opens_the_sink() {
    let home = std::env::temp_dir().join(format!(
        "ccgui-next-host-log-first-{}",
        uuid::Uuid::new_v4()
    ));
    assert!(
        !home.join(LOG_DIR).exists(),
        "precondition: the directory doesn't exist yet"
    );
    let now = SystemTime::now();
    let log = HostLog::for_new_run_at(&home, now).unwrap();
    log.line("first words\n");
    assert_eq!(std::fs::read_to_string(&log.path).unwrap(), "first words\n");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn host_log_redacts_the_launch_token_line() {
    let token_line = "dsh web: http://127.0.0.1:3080/?token=AbC-123_xyz\n";
    assert_eq!(
        loggable_line(token_line),
        "=== [redacted] launch token line ===\n"
    );
    let plain = "ready on http://127.0.0.1:3080\n";
    assert_eq!(loggable_line(plain), plain);
    let mentions = "GET /?notoken=1&tokenish=2\n";
    assert_eq!(loggable_line(mentions), mentions);
}

#[tokio::test]
async fn ring_drain_keeps_the_token_in_memory_and_out_of_the_log() {
    use tokio::io::AsyncWriteExt;

    let home = std::env::temp_dir().join(format!(
        "ccgui-next-host-log-drain-{}",
        uuid::Uuid::new_v4()
    ));
    let path = HostLog::path_for(&home, SystemTime::now()).unwrap();
    let log = HostLog::open(path.clone());
    let buf = Arc::new(Mutex::new(String::new()));

    let (mut writer, reader) = tokio::io::duplex(4096);
    spawn_ring_drain(reader, buf.clone(), None, Some(log));
    writer
        .write_all(b"dsh web: http://127.0.0.1:3080/?token=AbC-123_xyz\n")
        .await
        .unwrap();
    writer
        .write_all(b"ready on http://127.0.0.1:3080\n")
        .await
        .unwrap();
    drop(writer);

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut logged;
    loop {
        logged = std::fs::read_to_string(&path).unwrap_or_default();
        if logged.contains("ready on") || Instant::now() > deadline {
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }

    let ring = ring_snapshot(&buf);
    assert!(ring.contains("token=AbC-123_xyz"), "{ring}");
    assert!(ring.contains("ready on"), "{ring}");
    assert!(logged.contains("ready on"), "{logged}");
    assert!(logged.contains("[redacted] launch token line"), "{logged}");
    assert!(!logged.contains("AbC-123_xyz"), "{logged}");
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn origin_locality_is_detected_from_the_configured_origin() {
    for origin in [
        "http://127.0.0.1:3080",
        "http://localhost:3080",
        "http://0.0.0.0:3080",
        "http://[::1]:3080",
        "http://[::1]",
        "http://127.0.0.1",
        "https://LOCALHOST:3080",
        "http://127.0.0.1:3080/",
    ] {
        assert!(origin_is_local(origin), "{origin}");
    }
    for origin in [
        "https://dsh.example.com:3080",
        "http://192.168.1.10:3080",
        "http://[2001:db8::1]:3080",
    ] {
        assert!(!origin_is_local(origin), "{origin}");
    }
}

#[test]
fn launch_token_is_extracted_from_web_url_line() {
    let line = "dsh web: http://127.0.0.1:3080/?token=test-launch-token";
    assert_eq!(
        extract_launch_token(line).as_deref(),
        Some("test-launch-token")
    );
}

#[test]
fn launch_token_needs_query_prefix_and_stops_at_delimiter() {
    assert!(extract_launch_token("no token here").is_none());
    assert!(extract_launch_token("dsh web: http://127.0.0.1:3080/token=x").is_none());
    assert_eq!(
        extract_launch_token("GET /?token=abc-DEF_123 trailing").as_deref(),
        Some("abc-DEF_123")
    );
}

#[test]
fn describe_namespace_is_normalized_to_flat_view() {
    let value = json!({
        "namespaces": [
            {"ns": "other", "value": {"provider": "x", "model": "y"}},
            {"ns": "agent-default-model", "value": {"provider": "deepseek", "model": "deepseek-chat"}},
        ]
    });
    assert_eq!(
        normalize_describe(&value),
        json!({"provider": "deepseek", "model": "deepseek-chat"})
    );
    assert_eq!(normalize_describe(&json!({})), json!({}));
}
