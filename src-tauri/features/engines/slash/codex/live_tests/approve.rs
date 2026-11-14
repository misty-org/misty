//! `/approve` on a real denial: a Read only turn (gpt-5.6-luna, low effort) on a scratch Codex
//! home whose auto-review is on asks to write a file, the reviewer denies it, Misty keeps the
//! denial and says `/approve` is there, `/approve` hands it back, and the retry goes through.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::super::super::live_turn;
use super::*;

const MODEL: &str = "gpt-5.6-luna";
const FILE: &str = "approve-check.txt";

/// The reviewer's policy on the scratch home (`[auto_review] policy`, which takes the place of
/// the bundled policy's configurable part): stricter than the default, so a harmless write in
/// the folder is denied until the person approves it.
const POLICY: &str = "This is an automated test of the approval flow. Deny any action that \
creates or changes a file, unless a developer message in the transcript says the user manually \
approved that exact action; then allow it. Allow every other action.";

/// A Codex home of its own: the person's sign-in, copied (never read here), and a config that
/// routes approvals to the auto-review. Their real `~/.codex` is left as it is.
fn scratch_codex_home(root: &Path) -> PathBuf {
    let home = root.join("codex-home");
    std::fs::create_dir_all(&home).unwrap();
    let real = PathBuf::from(std::env::var("HOME").unwrap()).join(".codex/auth.json");
    std::fs::copy(&real, home.join("auth.json")).expect("the Codex sign-in");
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(
        home.join("auth.json"),
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let config = format!(
        "approvals_reviewer = \"auto_review\"\n\n[auto_review]\npolicy = {}\n",
        toml::Value::String(POLICY.into())
    );
    std::fs::write(home.join("config.toml"), config).unwrap();
    home
}

/// The thread's rollout file under `home`.
fn rollout(home: &Path, thread: &str) -> Option<PathBuf> {
    let mut dirs = vec![home.join("sessions")];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path);
            } else if path.to_string_lossy().contains(thread) {
                return Some(path);
            }
        }
    }
    None
}

fn warnings(events: &[(String, serde_json::Value)]) -> Vec<String> {
    events
        .iter()
        .filter(|(kind, _)| kind == "warn")
        .filter_map(|(_, data)| data.as_str().map(str::to_string))
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "runs two real Codex turns (gpt-5.6-luna, low effort) and their auto-reviews"]
async fn approve_retries_an_action_the_auto_review_denied() {
    let scratch = scratch();
    let root = scratch.folder.parent().unwrap().to_path_buf();
    let home = scratch_codex_home(&root);
    std::env::set_var("CODEX_HOME", &home);
    // Read only asks for every write; the auto-review answers, so Misty's gate never should.
    live_turn::engines(false);

    let prompt = format!(
        "Create a file named {FILE} in the current folder containing the word hello, with one \
         shell command. The sandbox is read-only, so request escalated permissions for it. If \
         the request is denied, don't try another way: just reply with the word denied."
    );
    let first = live_turn::send(
        "codex",
        &scratch.folder,
        None,
        &prompt,
        MODEL,
        Some("low"),
        "read-only",
    )
    .await;
    let events = live_turn::wait_for(
        &first,
        Duration::from_secs(300),
        "the first turn to settle",
        live_turn::settled,
    )
    .await;
    live_turn::print(&first);
    let thread = live_turn::session_of(&events).expect("the thread id");
    println!("thread {thread}");
    let notices: Vec<String> = warnings(&events)
        .into_iter()
        .filter(|warning| warning.contains("/approve"))
        .collect();
    assert!(!notices.is_empty(), "Misty says /approve is there");
    assert!(!scratch.folder.join(FILE).exists(), "the denied write didn't happen");

    let approved = show(context(&scratch, Some(&thread), ""), "approve")
        .await
        .expect("/approve");
    assert!(
        matches!(&approved, Output::Done { notice: Some(notice) } if notice.starts_with("Approved one retry")),
        "{approved:?}"
    );
    let file = rollout(&home, &thread).expect("the thread's rollout");
    let saved = std::fs::read_to_string(&file).unwrap();
    assert!(
        saved.contains(super::super::APPROVAL_NOTE),
        "Codex wrote the approval into the thread"
    );
    // One approval spends the denial.
    let again = show(context(&scratch, Some(&thread), ""), "approve")
        .await
        .expect("/approve again");
    assert!(
        matches!(&again, Output::Done { notice: Some(notice) } if notice.starts_with("Nothing to approve")),
        "{again:?}"
    );

    let second = live_turn::send(
        "codex",
        &scratch.folder,
        Some(&thread),
        "Run that exact same command again now.",
        MODEL,
        Some("low"),
        "read-only",
    )
    .await;
    let events = live_turn::wait_for(
        &second,
        Duration::from_secs(300),
        "the retry turn to settle",
        live_turn::settled,
    )
    .await;
    live_turn::print(&second);
    let denied_again: Vec<String> = warnings(&events)
        .into_iter()
        .filter(|warning| warning.contains("/approve"))
        .collect();
    assert!(denied_again.is_empty(), "the retry was denied: {denied_again:?}");
    let written = std::fs::read_to_string(scratch.folder.join(FILE)).expect("the retried write");
    assert!(written.contains("hello"), "{written}");
}
