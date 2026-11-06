// Tests build their fixtures directly, outside the file gate.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::{net::TcpListener, time::Instant};

use misty_agent::runtime::{InProcessPageReader, PageReader};
use serde::Deserialize;

use super::super::ConfinedPageReader;
use super::*;

async fn answer(input: &[u8]) -> String {
    String::from_utf8(run(input.to_vec()).await.unwrap()).unwrap()
}

#[tokio::test]
async fn the_worker_reads_a_page_like_the_function_does() {
    let page = "<html><head><title> Plans </title></head><body><nav>Home</nav><main><h1>Pro</h1><p>$10 a month, billed yearly.</p></main></body></html>";
    let confined = ConfinedPageReader
        .read(page, "text/html; charset=utf-8", "price", 500)
        .await
        .unwrap();
    let here = InProcessPageReader
        .read(page, "text/html; charset=utf-8", "price", 500)
        .await
        .unwrap();
    assert_eq!(confined, here);
    assert_eq!(confined.title, "Plans");
    assert!(confined.text.contains("$10"));
}

#[derive(Deserialize)]
struct Recorded {
    page: String,
    #[serde(rename = "contentType")]
    content_type: String,
    question: String,
    limit: usize,
}

/// Every page recorded from the TypeScript runtime, read both ways.
#[tokio::test]
async fn every_recorded_page_reads_the_same_in_the_worker() {
    let folder =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("crates/agent/tests/fixtures/web_fetch");
    let recorded: Vec<Recorded> =
        serde_json::from_str(&std::fs::read_to_string(folder.join("readable.json")).unwrap())
            .unwrap();
    assert!(recorded.len() >= 60);
    for case in recorded {
        let bytes = std::fs::read(folder.join("pages").join(&case.page)).unwrap();
        let page = String::from_utf8_lossy(&bytes);
        let confined = ConfinedPageReader
            .read(&page, &case.content_type, &case.question, case.limit)
            .await;
        let here = InProcessPageReader
            .read(&page, &case.content_type, &case.question, case.limit)
            .await;
        assert_eq!(confined, here, "{}", case.page);
    }
}

#[tokio::test]
async fn a_page_with_nothing_in_it_fails_the_same_way() {
    let confined = ConfinedPageReader
        .read("just words", "text/html", "", 500)
        .await;
    let here = InProcessPageReader
        .read("just words", "text/html", "", 500)
        .await;
    assert_eq!(confined, here);
}

#[tokio::test]
async fn a_large_page_goes_through_both_pipes() {
    let lines: String = (0..60_000)
        .map(|index| format!("<p>Plan {index} costs $10 a month.</p>"))
        .collect();
    let page = format!("<html><body>{lines}</body></html>");
    let confined = ConfinedPageReader
        .read(&page, "text/html", "plans", 15_000)
        .await
        .unwrap();
    assert!(confined.truncated);
    assert_eq!(
        confined,
        InProcessPageReader
            .read(&page, "text/html", "plans", 15_000)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn a_page_over_the_limit_fails_plainly() {
    let page = "x".repeat(misty_page_reader::protocol::MAX_INPUT_BYTES);
    let failed = ConfinedPageReader.read(&page, "text/html", "", 500).await;
    assert!(matches!(
        failed,
        Err(misty_agent::runtime::PageReadError::Reader(_))
    ));
}

/// Nothing falls back to this process: a worker that fails is that fetch's error.
#[tokio::test]
async fn a_failing_worker_is_an_error_and_not_a_second_try_here() {
    let refused = answer(b"no settings line").await;
    assert!(refused.contains("refused"), "{refused}");
    let bytes = worker().unwrap();
    let broken = stage(bytes).unwrap();
    fs::set_permissions(&broken.executable, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(&broken.executable, b"#!/bin/sh\nexit 3\n").unwrap();
    fs::set_permissions(&broken.executable, fs::Permissions::from_mode(0o500)).unwrap();
    assert!(run_in(&broken, b"anything".to_vec()).await.is_err());
}

#[test]
fn a_changed_copy_is_never_run() {
    let bytes = worker().unwrap();
    let copy = stage(bytes).unwrap();
    assert!(still_intact(&copy.executable, bytes));
    fs::set_permissions(&copy.executable, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!still_intact(&copy.executable, bytes));
    fs::write(&copy.executable, b"something else").unwrap();
    fs::set_permissions(&copy.executable, fs::Permissions::from_mode(0o500)).unwrap();
    assert!(!still_intact(&copy.executable, bytes));
}

#[tokio::test]
async fn one_copy_lasts_across_reads_and_a_tampered_one_is_replaced() {
    let bytes = worker().unwrap();
    let first = staged().unwrap();
    let again = staged().unwrap();
    // Other tests stage too, so compare the rule rather than this one's identity alone.
    assert!(still_intact(&again.executable, bytes));
    drop((first, again));
    let current = staged().unwrap();
    fs::set_permissions(&current.executable, fs::Permissions::from_mode(0o700)).unwrap();
    let replaced = staged().unwrap();
    assert_ne!(replaced.executable, current.executable);
    assert!(still_intact(&replaced.executable, bytes));
}

/// The worker's own attempts, from inside its real profile. Debug builds of the worker hold these
/// probes, so a release can't, and each has a case that must work so a broken probe can't pass.
#[cfg(debug_assertions)]
mod confinement {
    use super::*;

    async fn probe(what: &str, argument: &str) -> String {
        answer(format!("probe {what} {argument}").as_bytes()).await
    }

    fn secret_file() -> (tempfile::NamedTempFile, String) {
        // The real home folder, which is where the person's own files are, not a temp path.
        let home = dirs::home_dir().unwrap();
        let file = tempfile::Builder::new()
            .prefix(".misty-reader-probe-")
            .tempfile_in(home)
            .unwrap();
        std::fs::write(file.path(), "secret").unwrap();
        let path = file.path().to_str().unwrap().to_owned();
        (file, path)
    }

    #[tokio::test]
    async fn it_cannot_read_or_list_files_outside() {
        let (_file, path) = secret_file();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "secret");
        assert_eq!(probe("read", &path).await, "refused");
        assert_eq!(probe("read", "/etc/passwd").await, "refused");
        assert_eq!(
            probe("list", dirs::home_dir().unwrap().to_str().unwrap()).await,
            "refused"
        );
        // It can read its own binary, so a refusal above is the profile and not the probe.
        let own = staged().unwrap();
        assert_eq!(probe("read", own.executable.to_str().unwrap()).await, "ok");
    }

    #[tokio::test]
    async fn it_cannot_write_anywhere() {
        let own = staged().unwrap();
        assert_eq!(
            probe("write", own.folder_path.join("written").to_str().unwrap()).await,
            "refused"
        );
        assert!(!own.folder_path.join("written").exists());
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("written");
        assert_eq!(probe("write", target.to_str().unwrap()).await, "refused");
        assert!(!target.exists());
    }

    #[tokio::test]
    async fn it_cannot_reach_the_network() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        // The listener is really there.
        assert!(std::net::TcpStream::connect(address).is_ok());
        assert_eq!(probe("connect", &address.to_string()).await, "refused");
        assert_eq!(probe("connect", "1.1.1.1:443").await, "refused");
        assert_eq!(probe("resolve", "example.com").await, "refused");
    }

    #[tokio::test]
    async fn it_cannot_start_a_program() {
        assert_eq!(probe("run", "/usr/bin/true").await, "refused");
    }

    #[tokio::test]
    async fn the_environment_carries_nothing() {
        // `command` clears it; a key in this process's environment must not reach a parser.
        std::env::set_var("MISTY_TEST_SECRET", "1");
        let worker = staged().unwrap();
        let spawned = command(&worker);
        let environment: Vec<_> = spawned
            .as_std()
            .get_envs()
            .map(|(name, _)| name.to_owned())
            .collect();
        assert!(!environment.iter().any(|name| name == "MISTY_TEST_SECRET"));
        std::env::remove_var("MISTY_TEST_SECRET");
    }
}

/// Reports what a read costs. Run with `--ignored --nocapture`; numbers go in the plan.
#[tokio::test]
#[ignore]
async fn how_long_a_read_takes() {
    let lines: String = (0..2000)
        .map(|index| format!("<p>Plan {index} costs $10 a month.</p>"))
        .collect();
    let page = format!("<html><body>{lines}</body></html>");
    let mut times = Vec::new();
    for _ in 0..30 {
        let started = Instant::now();
        ConfinedPageReader
            .read(&page, "text/html", "plans", 15_000)
            .await
            .unwrap();
        times.push(started.elapsed());
    }
    times.sort();
    eprintln!(
        "first-sorted {:?} median {:?} last {:?}",
        times[0], times[15], times[29]
    );
}
