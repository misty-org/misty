use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use super::live_turn;
use crate::engines::modes::{self, ModeKind};

const PROMPT: &str = "make a beautiful chess website and one medium difficulty bot with a free \
cloud based stockfish or similar";

const LIMIT: Duration = Duration::from_secs(30 * 60);

fn use_real_home() {
    // SAFETY: getpwuid returns the calling user's static record, read before anything else.
    let home = unsafe {
        let record = libc::getpwuid(libc::getuid());
        assert!(!record.is_null(), "the user's account record");
        std::ffi::CStr::from_ptr((*record).pw_dir)
            .to_string_lossy()
            .into_owned()
    };
    std::env::set_var("HOME", home);
}

fn edits_mode(id: &str) -> String {
    let engine = crate::engines::engine_by_id(id).expect("known engine");
    modes::named(engine.as_ref())
        .into_iter()
        .find(|mode| mode.kind == ModeKind::Edits)
        .map(|mode| mode.id.to_string())
        .unwrap_or_else(|| "auto".into())
}

fn files_in(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                if name != ".git" && name != "node_modules" {
                    dirs.push(path);
                }
            } else if let Ok(relative) = path.strip_prefix(root) {
                found.push(relative.to_string_lossy().into_owned());
            }
        }
    }
    found.sort();
    found
}

fn reply(events: &[(String, Value)]) -> String {
    events
        .iter()
        .filter(|(kind, _)| kind == "delta")
        .filter_map(|(_, data)| data.as_str())
        .collect()
}

fn failure(events: &[(String, Value)]) -> Option<String> {
    events
        .iter()
        .find(|(kind, _)| kind == "error")
        .map(|(_, data)| data.to_string().chars().take(400).collect())
}

struct Outcome {
    engine: String,
    folder: PathBuf,
    error: Option<String>,
    files: Vec<String>,
    kinds: String,
    reply: String,
    seconds: u64,
}

async fn try_engine(id: String, root: PathBuf) -> Outcome {
    let folder = root.join(&id);
    std::fs::create_dir_all(&folder).unwrap();
    let folder = folder.canonicalize().unwrap();
    let started = std::time::Instant::now();
    let permission = edits_mode(&id);
    let sent = crate::engines::send_message_inner(
        crate::engines::support::state().expect("engines() first"),
        id.clone(),
        folder.to_string_lossy().into_owned(),
        None,
        PROMPT.to_string(),
        Vec::new(),
        None,
        None,
        None,
        Some(permission),
        None,
        None,
        None,
        None,
        crate::engines::LaunchExtras::default(),
    )
    .await;
    let run = match sent {
        Ok(sent) => sent.run_id,
        Err(error) => {
            return Outcome {
                engine: id,
                folder,
                error: Some(format!("didn't start: {error}")),
                files: Vec::new(),
                kinds: String::new(),
                reply: String::new(),
                seconds: 0,
            }
        }
    };
    println!("{id}: run {run} in {}", folder.display());
    let deadline = tokio::time::Instant::now() + LIMIT;
    let mut events = live_turn::events(&run);
    while !live_turn::settled(&events) && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(1)).await;
        events = live_turn::events(&run);
    }
    let timed_out = !live_turn::settled(&events);
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    for (kind, _) in &events {
        *counts.entry(kind.as_str()).or_default() += 1;
    }
    let kinds = counts
        .iter()
        .map(|(kind, count)| format!("{kind} {count}"))
        .collect::<Vec<_>>()
        .join(", ");
    Outcome {
        error: if timed_out {
            Some("still running after 30 minutes".into())
        } else {
            failure(&events)
        },
        files: files_in(&folder),
        kinds,
        reply: reply(&events),
        seconds: started.elapsed().as_secs(),
        engine: id,
        folder,
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "runs the chess prompt as a real turn on every installed engine, at once"]
async fn every_engine_builds_the_chess_site() {
    use_real_home();
    let _ = rustls::crypto::ring::default_provider().install_default();
    live_turn::engines(true);
    let root = std::env::var("MISTY_ENGINE_TEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| tempfile::tempdir().expect("a scratch folder").keep());
    std::fs::create_dir_all(&root).unwrap();
    let only: Option<Vec<String>> = std::env::var("MISTY_ENGINE_TEST_ONLY")
        .ok()
        .map(|list| list.split(',').map(|id| id.trim().to_string()).collect());
    let installed: Vec<String> = crate::engines::list_engines_blocking()
        .into_iter()
        .filter(|(info, _)| info.installed)
        .map(|(info, _)| info.id)
        .filter(|id| only.as_ref().is_none_or(|only| only.contains(id)))
        .collect();
    assert!(!installed.is_empty(), "no engine is installed");
    println!("engines: {}", installed.join(", "));
    println!("folders under {}", root.display());

    let outcomes = futures_util::future::join_all(
        installed.into_iter().map(|id| try_engine(id, root.clone())),
    )
    .await;

    let mut failed = Vec::new();
    for outcome in &outcomes {
        println!("\n=== {} ({}s)", outcome.engine, outcome.seconds);
        println!("events: {}", outcome.kinds);
        println!("folder: {}", outcome.folder.display());
        println!(
            "files: {}",
            if outcome.files.is_empty() {
                "none".into()
            } else {
                outcome.files.join(", ")
            }
        );
        if let Some(error) = &outcome.error {
            println!("error: {error}");
        }
        let tail: String = outcome
            .reply
            .chars()
            .rev()
            .take(800)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        println!("reply (end): {tail}");
        if outcome.error.is_some() || outcome.files.is_empty() {
            failed.push(outcome.engine.clone());
        }
    }
    assert!(
        failed.is_empty(),
        "these engines made nothing or failed: {}",
        failed.join(", ")
    );
}
