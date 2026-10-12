//! Escape attempts against the command sandbox. macOS only.
#![cfg(target_os = "macos")]
mod common;

use common::{failed, fixture};
use serde_json::json;
use std::fs;

fn exit(value: &serde_json::Value) -> i64 {
    value["exitCode"].as_i64().unwrap_or(-999)
}

#[tokio::test(flavor = "multi_thread")]
async fn commands_run_in_the_project() {
    let f = fixture();
    let result = f.run("pwd && echo built > out.txt && cat out.txt").await;
    assert_eq!(exit(&result), 0, "{result}");
    assert!(result["output"].as_str().unwrap().contains("built"));
    assert_eq!(fs::read_to_string(f.root().join("out.txt")).unwrap(), "built\n");
    let failing = f.run("echo nope >&2; exit 3").await;
    assert_eq!(exit(&failing), 3);
    assert!(!failed(&failing), "a non-zero exit is a normal result");
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_outside_the_project_are_denied() {
    let f = fixture();
    let target = f.outside.path().join("escaped.txt");
    let result = f.run(&format!("echo pwned > '{}'", target.display())).await;
    assert_ne!(exit(&result), 0, "{result}");
    assert!(!target.exists());
    let home = std::env::var("HOME").unwrap();
    let marker = format!("{home}/.misty-sandbox-escape-test");
    let result = f.run(&format!("touch '{marker}'")).await;
    assert_ne!(exit(&result), 0, "{result}");
    assert!(!std::path::Path::new(&marker).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_outside_the_project_are_denied() {
    let f = fixture();
    let secret = f.outside.path().join("secret.txt");
    fs::write(&secret, "TOP SECRET").unwrap();
    let result = f.run(&format!("cat '{}'", secret.display())).await;
    assert!(!result["output"].as_str().unwrap().contains("TOP SECRET"), "{result}");
    let home = std::env::var("HOME").unwrap();
    for path in [format!("{home}/.ssh"), format!("{home}/Library/Keychains"), format!("{home}/Documents"), format!("{home}")] {
        let result = f.run(&format!("ls '{path}'")).await;
        assert_ne!(exit(&result), 0, "{path}: {result}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn git_folder_and_secrets_are_protected() {
    let f = fixture();
    fs::create_dir_all(f.root().join(".git/hooks")).unwrap();
    fs::write(f.root().join(".env"), "API_KEY=sk-live").unwrap();
    fs::write(f.root().join(".env.example"), "API_KEY=").unwrap();
    let hook = f.run("echo 'curl evil' > .git/hooks/pre-commit").await;
    assert_ne!(exit(&hook), 0, "{hook}");
    assert!(!f.root().join(".git/hooks/pre-commit").exists());
    let env = f.run("cat .env").await;
    assert!(!env["output"].as_str().unwrap().contains("sk-live"), "{env}");
    let example = f.run("cat .env.example").await;
    assert_eq!(exit(&example), 0, "{example}");
    let overwrite = f.run("echo X > .env.production").await;
    assert_ne!(exit(&overwrite), 0, "{overwrite}");
    let rename = f.run("cd .. && mv \"$OLDPWD\" \"$OLDPWD-moved\"").await;
    assert_ne!(exit(&rename), 0, "{rename}");
    assert!(f.root().exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn network_is_closed_without_package_installs() {
    let f = fixture();
    let curl = f.run("curl -sS --max-time 5 https://example.com").await;
    assert_ne!(exit(&curl), 0, "{curl}");
    let lookup = f.run("dscacheutil -q host -a name example.com; host -W 2 example.com 8.8.8.8").await;
    assert!(!lookup["output"].as_str().unwrap().contains("ip_address:"), "{lookup}");
    assert!(!lookup["output"].as_str().unwrap().contains("has address"), "{lookup}");
}

#[tokio::test(flavor = "multi_thread")]
async fn environment_is_replaced() {
    std::env::set_var("MISTY_TEST_SECRET_TOKEN", "do-not-leak");
    let f = fixture();
    let env = f.run("env").await;
    let output = env["output"].as_str().unwrap();
    assert!(!output.contains("do-not-leak"), "{output}");
    assert!(output.contains("CI=1"));
    let home = std::env::var("HOME").unwrap();
    assert!(!output.contains(&format!("HOME={home}\n")));
}

#[tokio::test(flavor = "multi_thread")]
async fn timeouts_and_stray_children_are_killed() {
    let f = fixture();
    let started = std::time::Instant::now();
    let slow = f
        .call("code.run", json!({ "command": "sleep 30", "timeoutSeconds": 1 }))
        .await;
    assert_eq!(slow["timedOut"], true, "{slow}");
    let stray = f.run("(sleep 60 &) ; echo started").await;
    assert_eq!(exit(&stray), 0, "{stray}");
    assert!(started.elapsed().as_secs() < 15);
}

#[tokio::test(flavor = "multi_thread")]
async fn commands_cannot_listen_for_connections() {
    let f = fixture();
    let python = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
        .into_iter()
        .find(|path| std::path::Path::new(path).exists());
    let Some(python) = python else { return };
    for host in ["127.0.0.1", "0.0.0.0", "::"] {
        let family = if host.contains(':') { "AF_INET6" } else { "AF_INET" };
        let result = f
            .run(&format!("{python} -c \"import socket; s=socket.socket(socket.{family}); s.bind(('{host}', 0)); s.listen(); print('LIST'+'ENING')\""))
            .await;
        assert!(!result["output"].as_str().unwrap().contains("LISTENING"), "{host}: {result}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn watchers_run_in_the_background_until_stopped() {
    let f = fixture();
    let started = f
        .call("code.start", json!({ "command": "while true; do date > stamp.txt; echo tick; sleep 0.3; done", "name": "watcher" }))
        .await;
    let id = started["id"].as_str().unwrap().to_owned();
    assert_eq!(started["running"], true, "{started}");
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    let logs = f.call("code.logs", json!({ "id": id })).await;
    assert!(logs["logs"].as_str().unwrap().contains("tick"), "{logs}");
    assert!(f.root().join("stamp.txt").exists());
    let listed = f.call("code.processes", json!({})).await;
    assert_eq!(listed["processes"].as_array().unwrap().len(), 1);
    assert_eq!(f.call("code.stop", json!({ "id": id })).await["stopped"], true);
    let before = std::fs::read_to_string(f.root().join("stamp.txt")).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    assert_eq!(std::fs::read_to_string(f.root().join("stamp.txt")).unwrap(), before, "stopped means stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn node_runs_when_installed() {
    let f = fixture();
    let which = f.run("command -v node || true").await;
    if which["output"].as_str().unwrap_or("").trim().is_empty() {
        return;
    }
    let result = f.run("node -e \"console.log(require('path').join('a','b'))\"").await;
    assert_eq!(exit(&result), 0, "{result}");
    assert!(result["output"].as_str().unwrap().contains("a/b"));
}

/// Needs the internet: `cargo test -- --ignored`.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn package_installs_reach_only_registries() {
    let mut f = fixture();
    f.project.allow_installs = true;
    let registry = f.run("curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://registry.npmjs.org/left-pad").await;
    assert_eq!(registry["output"].as_str().unwrap().trim(), "200", "{registry}");
    let blocked = f.run("curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://example.com/").await;
    assert_ne!(exit(&blocked), 0, "{blocked}");
    let direct = f.run("curl -sS --noproxy '*' --max-time 5 https://registry.npmjs.org/").await;
    assert_ne!(exit(&direct), 0, "a command can't bypass the proxy: {direct}");
    let which = f.run("command -v npm || true").await;
    if !which["output"].as_str().unwrap_or("").trim().is_empty() {
        let install = f
            .call("code.run", json!({ "command": "echo '{\"name\":\"probe\",\"version\":\"1.0.0\"}' > package.json && npm install left-pad@1.3.0 --no-audit --no-fund", "timeoutSeconds": 120 }))
            .await;
        assert_eq!(exit(&install), 0, "{install}");
        assert!(f.root().join("node_modules/left-pad/package.json").exists());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn detached_children_stop_with_their_command() {
    let f = fixture();
    // A child that leaves the process group (perl's setsid) and keeps writing.
    let result = f
        .call(
            "code.run",
            json!({ "command": "perl -e 'use POSIX; if (fork()==0) { POSIX::setsid(); while (1) { open(my $f, \">>\", \"ticks.txt\"); print $f \"t\\n\"; close $f; select(undef,undef,undef,0.2); } } sleep 1; print \"parent done\\n\"'", "timeoutSeconds": 20 }),
        )
        .await;
    assert_eq!(exit(&result), 0, "{result}");
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    let before = std::fs::read_to_string(f.root().join("ticks.txt")).unwrap_or_default();
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    let after = std::fs::read_to_string(f.root().join("ticks.txt")).unwrap_or_default();
    assert!(!before.is_empty(), "the child ran");
    assert_eq!(before, after, "the detached child was stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn fork_bombs_hit_a_process_limit() {
    let f = fixture();
    // Tries 600 children; the tree may add only 256 over the user's count.
    let started = std::time::Instant::now();
    let result = f
        .call("code.run", json!({ "command": "perl -e 'my $n=0; while ($n < 600) { my $p = fork(); if (!defined $p) { print \"limited at $n\\n\"; last } if ($p == 0) { sleep 30; exit } $n++ } print \"done\\n\"'", "timeoutSeconds": 30 }))
        .await;
    let output = result["output"].as_str().unwrap_or("");
    let limited: Option<u32> = output
        .lines()
        .find_map(|line| line.strip_prefix("limited at ")?.trim().parse().ok());
    // 256, give or take processes the person started or ended meanwhile.
    assert!(limited.is_some_and(|n| n <= 300), "{result}");
    assert!(started.elapsed().as_secs() < 20, "the command ended instead of hanging");
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_are_capped_for_the_model() {
    let f = fixture();
    let line = "x".repeat(1_900);
    std::fs::write(f.root().join("wide.txt"), format!("{line}\n").repeat(200)).unwrap();
    let read = f.call("code.read", json!({ "path": "wide.txt", "limit": 2000 })).await;
    assert!(read["content"].as_str().unwrap().len() <= 101_000, "{}", read["endLine"]);
    assert_eq!(read["more"], true);
    let next = read["endLine"].as_u64().unwrap() + 1;
    let rest = f.call("code.read", json!({ "path": "wide.txt", "offset": next })).await;
    assert_eq!(rest["startLine"], next);
}
