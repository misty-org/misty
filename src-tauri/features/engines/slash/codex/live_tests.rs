use std::path::PathBuf;

use serde_json::json;

use super::super::{run, Context, Output};
use crate::engines::codex_rpc::{self, Session};

/// `/approve` on a real auto-review denial (two Codex turns).
mod approve;

struct Scratch {
    _dir: tempfile::TempDir,
    folder: PathBuf,
    db: database::store::Store,
}

/// The test binary points HOME at a scratch folder (`isolate_for_tests`); Codex's sign-in,
/// config and threads live in the person's real one, which their account record names.
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

fn scratch() -> Scratch {
    use_real_home();
    let dir = tempfile::tempdir().expect("a scratch folder");
    std::fs::create_dir_all(dir.path().join("project")).unwrap();
    let folder = dir.path().join("project").canonicalize().unwrap();
    let db = database::store::Store::at(dir.path().join("misty.db"));
    Scratch {
        _dir: dir,
        folder,
        db,
    }
}

fn context(scratch: &Scratch, session: Option<&str>, args: &str) -> Context {
    Context {
        engine: "codex".into(),
        account: "live-test".into(),
        conversation: "live-test".into(),
        folder: Some(scratch.folder.clone()),
        session: session.map(str::to_string),
        args: args.into(),
        db: scratch.db.clone(),
    }
}

/// A real thread at $0: `thread/start` makes one and runs no turn. Codex writes a thread's
/// rollout file only once something is recorded in it, and an unwritten thread is gone for
/// every other app-server, so it is named while it is loaded (a chat's thread always has
/// its rollout: Misty keeps a thread id only after a turn).
async fn new_thread(scratch: &Scratch) -> String {
    let command = codex_rpc::chat_command(Some(&scratch.folder))
        .await
        .expect("the app-server command");
    let mut rpc = Session::start(command, true, super::CALL_TIMEOUT)
        .await
        .expect("the app-server starts");
    let started = rpc
        .call(
            "thread/start",
            json!({ "cwd": scratch.folder.to_string_lossy() }),
        )
        .await
        .expect("thread/start");
    let thread = super::text_at(&started, "/thread/id")
        .expect("a thread id")
        .to_string();
    rpc.call(
        "thread/name/set",
        json!({ "threadId": thread, "name": "Misty live test" }),
    )
    .await
    .expect("thread/name/set");
    rpc.stop().await;
    thread
}

async fn show(context: Context, name: &str) -> Result<Output, String> {
    let args = context.args.clone();
    let outcome = run(context, name).await;
    let shown = match &outcome {
        Ok(output) => serde_json::to_string_pretty(output).unwrap(),
        Err(error) => format!("ERROR: {error}"),
    };
    println!("\n===== /{name} {args}\n{shown}");
    outcome
}

/// Commands that only read, with the arguments that only read.
const READ_ONLY: &[(&str, &str)] = &[
    ("status", ""),
    ("usage", ""),
    ("usage", "daily"),
    ("usage", "weekly"),
    ("usage", "cumulative"),
    ("mcp", ""),
    ("mcp", "verbose"),
    ("hooks", ""),
    ("apps", ""),
    ("plugins", ""),
    // A local plugin, an installed one from the online catalog, and one only a search of
    // the catalog finds.
    ("plugins", "documents"),
    ("plugins", "github@openai-curated-remote"),
    ("plugins", "website-maker"),
    ("personality", ""),
    ("experimental", ""),
    ("memories", ""),
    ("debug-config", ""),
    ("ps", ""),
    ("agent", ""),
    ("subagents", ""),
    ("goal", ""),
    ("import", ""),
    ("rollout", ""),
];

#[tokio::test]
#[ignore = "runs the installed Codex CLI"]
async fn read_only_commands_without_a_thread() {
    let scratch = scratch();
    let mut failed = Vec::new();
    for (name, args) in READ_ONLY {
        if show(context(&scratch, None, args), name).await.is_err() {
            failed.push(*name);
        }
    }
    assert!(failed.is_empty(), "failed: {failed:?}");
}

#[tokio::test]
#[ignore = "runs the installed Codex CLI"]
async fn read_only_commands_on_a_thread() {
    let scratch = scratch();
    let thread = new_thread(&scratch).await;
    println!("thread {thread}");
    let mut failed = Vec::new();
    for (name, args) in READ_ONLY {
        if show(context(&scratch, Some(&thread), args), name)
            .await
            .is_err()
        {
            failed.push(*name);
        }
    }
    // Arguments Misty answers itself, before any call.
    for (name, args) in [
        ("usage", "monthly"),
        ("mcp", "login"),
        ("personality", "grumpy"),
        ("experimental", "no_such_feature on"),
        ("memories", "maybe"),
        ("import", "please"),
        ("plugins", "no-such-plugin"),
    ] {
        let _ = show(context(&scratch, Some(&thread), args), name).await;
    }
    assert!(failed.is_empty(), "failed: {failed:?}");
}

#[tokio::test]
#[ignore = "runs the installed Codex CLI"]
async fn rename_and_fork_a_thread() {
    let scratch = scratch();
    let thread = new_thread(&scratch).await;
    println!("thread {thread}");
    let renamed = show(context(&scratch, Some(&thread), "Live test chat"), "rename")
        .await
        .expect("rename");
    assert!(matches!(&renamed, Output::Rename { title } if title == "Live test chat"));
    let status = show(context(&scratch, Some(&thread), ""), "status")
        .await
        .expect("status");
    assert!(
        serde_json::to_string(&status)
            .unwrap()
            .contains("Live test chat"),
        "status should name the thread"
    );
    let forked = show(context(&scratch, Some(&thread), "carry on"), "fork")
        .await
        .expect("fork");
    let Output::Fork {
        session, prompt, ..
    } = &forked
    else {
        panic!("fork gives a fork");
    };
    assert_ne!(session, &thread);
    assert_eq!(prompt.as_deref(), Some("carry on"));
    show(context(&scratch, Some(session), ""), "rollout")
        .await
        .expect("the fork is a thread of its own");
}
