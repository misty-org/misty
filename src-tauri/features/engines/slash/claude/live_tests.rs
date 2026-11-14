use std::path::{Path, PathBuf};

use super::super::{run, Context, Output};

struct Scratch {
    _dir: tempfile::TempDir,
    folder: PathBuf,
    db: database::store::Store,
}

/// The test binary points HOME at a scratch folder (`isolate_for_tests`); Claude Code's
/// sign-in, settings and sessions live in the person's real one, which their account
/// record names. Only these ignored tests run when they are asked for, so the swap reaches
/// nothing else.
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
    // Claude Code files sessions under the folder's real path.
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
        engine: "claude".into(),
        account: "live-test".into(),
        conversation: "live-test".into(),
        folder: Some(scratch.folder.clone()),
        session: session.map(str::to_string),
        args: args.into(),
        db: scratch.db.clone(),
    }
}

/// A real session at $0: `/context` is a local command, so Claude Code records the session
/// and answers without a model turn.
fn local_session(folder: &Path) -> String {
    let output = std::process::Command::new("claude")
        .args(["-p", "/context", "--output-format", "json"])
        .current_dir(folder)
        .stdin(std::process::Stdio::null())
        .output()
        .expect("claude runs");
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).expect("a JSON result");
    assert_eq!(
        result["num_turns"], 0,
        "a local command runs no turn: {result}"
    );
    assert_eq!(result["total_cost_usd"].as_f64(), Some(0.0), "{result}");
    result["session_id"]
        .as_str()
        .expect("a session id")
        .to_string()
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

const READ_ONLY: &[&str] = &[
    "status",
    "context",
    "memory",
    "hooks",
    "permissions",
    "sandbox",
    "skills",
    "plan",
    "help",
    "version",
    "doctor",
    "mcp",
    "tasks",
    "bashes",
];

#[tokio::test]
#[ignore = "runs the installed Claude Code CLI"]
async fn read_only_commands_without_a_session() {
    let scratch = scratch();
    let mut failed = Vec::new();
    for name in READ_ONLY {
        if show(context(&scratch, None, ""), name).await.is_err() {
            failed.push(*name);
        }
    }
    assert!(failed.is_empty(), "failed: {failed:?}");
}

#[tokio::test]
#[ignore = "runs the installed Claude Code CLI"]
async fn read_only_commands_in_a_session() {
    let scratch = scratch();
    let session = local_session(&scratch.folder);
    println!("session {session}");
    let mut failed = Vec::new();
    for name in READ_ONLY {
        if show(context(&scratch, Some(&session), ""), name)
            .await
            .is_err()
        {
            failed.push(*name);
        }
    }
    // Arguments the person may type that Misty answers itself.
    for (name, args) in [
        ("plan", "open"),
        ("plan", "add tests"),
        ("tasks", "stop nope"),
        ("tasks", "list everything"),
        ("mcp", "frobnicate"),
        ("mcp", "reconnect"),
        // Asks the process for its servers, then finds no such one: changes nothing.
        ("mcp", "reconnect no-such-server"),
    ] {
        let _ = show(context(&scratch, Some(&session), args), name).await;
    }
    assert!(failed.is_empty(), "failed: {failed:?}");
}

#[tokio::test]
#[ignore = "runs the installed Claude Code CLI"]
async fn rename_branch_and_fork_a_session() {
    let scratch = scratch();
    let session = local_session(&scratch.folder);
    println!("session {session}");
    let renamed = show(
        context(&scratch, Some(&session), "Live  test\nchat"),
        "rename",
    )
    .await
    .expect("rename");
    assert!(matches!(&renamed, Output::Rename { title } if title == "Live test chat"));
    // The name lands in the session, where `/status` reads it.
    let status = show(context(&scratch, Some(&session), ""), "status")
        .await
        .expect("status");
    let named = serde_json::to_string(&status).unwrap();
    assert!(
        named.contains("Live test chat"),
        "status should name the session"
    );

    let branched = show(context(&scratch, Some(&session), ""), "branch")
        .await
        .expect("branch");
    let Output::Fork {
        session: copy,
        title,
        prompt,
    } = &branched
    else {
        panic!("branch gives a fork");
    };
    assert_ne!(copy, &session);
    assert_eq!(title.as_deref(), Some("Live test chat (Branch)"));
    assert!(prompt.is_none());
    // The copy is a session of its own that Claude Code resumes.
    show(context(&scratch, Some(copy), ""), "status")
        .await
        .expect("the branch resumes");

    let named = show(context(&scratch, Some(&session), "Side path"), "branch")
        .await
        .expect("named branch");
    assert!(matches!(&named, Output::Fork { title: Some(title), .. } if title == "Side path"));

    let forked = show(context(&scratch, Some(&session), "write the tests"), "fork")
        .await
        .expect("fork");
    assert!(matches!(
        &forked,
        Output::Fork { prompt: Some(prompt), .. } if prompt == "write the tests"
    ));
    assert!(show(context(&scratch, Some(&session), ""), "fork")
        .await
        .is_err());
}
