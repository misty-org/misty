use super::*;
use crate::engines::slash::run as run_command;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

struct Scratch {
    _dir: tempfile::TempDir,
    folder: PathBuf,
    db: database::store::Store,
    engine: &'static str,
}

/// The test binary points HOME at a scratch folder; Misty's settings, which name where pi
/// and omp are installed, live in the person's real one.
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

fn scratch(engine: &'static str) -> Scratch {
    use_real_home();
    let dir = tempfile::tempdir().expect("a scratch folder");
    std::fs::create_dir_all(dir.path().join("project")).unwrap();
    let folder = dir.path().join("project").canonicalize().unwrap();
    let agent = dir.path().join("agent");
    std::fs::create_dir_all(&agent).unwrap();
    if engine == "pi" {
        std::fs::write(
            agent.join("models.json"),
            r#"{"providers":{"probe":{"baseUrl":"http://127.0.0.1:9/v1","api":"openai-completions","apiKey":"fake-probe","models":[{"id":"probe-model"}]}}}"#,
        )
        .unwrap();
    } else {
        std::fs::write(
            agent.join("models.yml"),
            "providers:\n  probe:\n    baseUrl: http://127.0.0.1:9/v1\n    api: openai-completions\n    apiKey: fake-probe\n    models:\n      - id: probe-model\n",
        )
        .unwrap();
    }
    std::env::set_var("PI_CODING_AGENT_DIR", &agent);
    std::env::set_var("PI_OFFLINE", "1");
    let db = database::store::Store::at(dir.path().join("misty.db"));
    Scratch {
        _dir: dir,
        folder,
        db,
        engine,
    }
}

fn context(scratch: &Scratch, session: Option<&str>, args: &str) -> Context {
    Context {
        engine: scratch.engine.into(),
        account: "live-test".into(),
        conversation: "live-test".into(),
        folder: Some(scratch.folder.clone()),
        session: session.map(str::to_string),
        args: args.into(),
        db: scratch.db.clone(),
    }
}

/// A saved session with one message of the person's, at $0: the prompt goes to the scratch
/// provider on a closed port and fails, with retries off.
async fn dead_end_session(scratch: &Scratch) -> String {
    let (mut cmd, bin) =
        crate::engines::pi_family::cli_command(scratch.engine, &scratch.folder).unwrap();
    let mode = if scratch.engine == "omp" {
        "rpc-ui"
    } else {
        "rpc"
    };
    cmd.args(["--mode", mode, "--model", "probe/probe-model"]);
    if scratch.engine == "omp" {
        cmd.arg("--no-title");
    }
    cmd.stdin(std::process::Stdio::piped());
    let mut child = cmd.spawn().unwrap_or_else(|error| panic!("{bin}: {error}"));
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
    for frame in [
        json!({"id": "retry", "type": "set_auto_retry", "enabled": false}),
        json!({"id": "prompt", "type": "prompt", "message": "hello probe"}),
    ] {
        stdin
            .write_all(format!("{frame}\n").as_bytes())
            .await
            .unwrap();
    }
    stdin.flush().await.unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(120), async {
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if value["type"] == "message_end" && value["message"]["role"] == "assistant" {
                assert_eq!(
                    value["message"]["stopReason"], "error",
                    "the scratch provider must not answer: {value}"
                );
                assert_eq!(value["message"]["usage"]["cost"]["total"], 0);
            }
            if value["type"] == "agent_end" && value["willRetry"] != true {
                return true;
            }
        }
        false
    })
    .await;
    assert_eq!(ended, Ok(true), "the prompt ends");
    stdin
        .write_all(b"{\"id\":\"state\",\"type\":\"get_state\"}\n")
        .await
        .unwrap();
    stdin.flush().await.unwrap();
    let session = loop {
        let line = lines
            .next_line()
            .await
            .unwrap()
            .expect("get_state's answer");
        let value: Value = serde_json::from_str(&line).unwrap_or_default();
        if value["id"] == "state" {
            break value["data"]["sessionId"].as_str().unwrap().to_string();
        }
    };
    drop(stdin);
    let _ = tokio::time::timeout(Duration::from_secs(15), child.wait()).await;
    session
}

async fn show(context: Context, name: &str) -> Result<Output, String> {
    let args = context.args.clone();
    let outcome = run_command(context, name).await;
    let shown = match &outcome {
        Ok(output) => serde_json::to_string_pretty(output).unwrap(),
        Err(error) => format!("ERROR: {error}"),
    };
    println!("\n===== /{name} {args}\n{shown}");
    outcome
}

fn forked_session(output: Output, from: &str) -> String {
    match output {
        Output::Fork { session, .. } => {
            assert_ne!(session, from, "a new session");
            session
        }
        other => panic!("expected a fork, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "runs the installed pi with a scratch agent folder; no model is reached"]
async fn pi_commands_on_a_real_session() {
    let scratch = scratch("pi");
    let session = dead_end_session(&scratch).await;
    let at = |args: &str| context(&scratch, Some(&session), args);

    let Output::Info { sections, .. } = show(at(""), "session").await.unwrap() else {
        panic!("/session shows info");
    };
    assert!(sections[0]
        .rows
        .iter()
        .any(|row| row.label == "Session" && row.value == session));
    assert!(sections[1]
        .rows
        .iter()
        .any(|row| row.label == "You" && row.value == "1"));

    let renamed = show(at("Probe name"), "name").await.unwrap();
    assert!(matches!(renamed, Output::Rename { ref title } if title == "Probe name"));
    let Output::Info { sections, .. } = show(at(""), "session").await.unwrap() else {
        panic!("/session shows info");
    };
    assert!(sections[0]
        .rows
        .iter()
        .any(|row| row.label == "Name" && row.value == "Probe name"));

    let Output::Info { sections, .. } = show(at("list"), "fork").await.unwrap() else {
        panic!("/fork list shows the messages");
    };
    assert_eq!(sections[0].rows[0].value, "hello probe");

    let Output::Info { sections, .. } = show(at(""), "tree").await.unwrap() else {
        panic!("/tree shows the tree");
    };
    let tree = sections[0].text.as_deref().unwrap();
    assert!(tree.contains("You: hello probe (current)"), "{tree}");

    let exported = show(at("probe-export.html"), "export").await.unwrap();
    assert!(
        scratch.folder.join("probe-export.html").exists(),
        "{exported:?}"
    );

    forked_session(show(at(""), "clone").await.unwrap(), &session);
    forked_session(show(at("1"), "fork").await.unwrap(), &session);
    assert!(show(at("9"), "fork").await.is_err());
}

#[tokio::test]
#[ignore = "runs the installed omp with a scratch agent folder; no model is reached"]
async fn omp_commands_on_a_real_session() {
    let scratch = scratch("omp");
    let session = dead_end_session(&scratch).await;
    let at = |args: &str| context(&scratch, Some(&session), args);

    let Output::Info { sections, .. } = show(at(""), "tree").await.unwrap() else {
        panic!("/tree shows the messages");
    };
    assert_eq!(sections[0].rows[0].value, "hello probe");
    let Output::Info { sections, .. } = show(at("list"), "branch").await.unwrap() else {
        panic!("/branch list shows the messages");
    };
    assert_eq!(sections[0].rows.len(), 1);
    forked_session(show(at(""), "branch").await.unwrap(), &session);
    assert!(show(at("2"), "branch").await.is_err());

    // `/session info` is one of omp's own commands, run in the turn: it prints its text and
    // answers without the agent.
    let mut rpc = RpcSession::open("omp", &scratch.folder, &session)
        .await
        .unwrap();
    let answer = rpc
        .call("prompt", json!({ "message": "/session info" }))
        .await
        .unwrap();
    assert_eq!(answer["agentInvoked"], false, "{answer}");
    // An rpc command omp doesn't have is refused at once, not waited out.
    let started = std::time::Instant::now();
    assert!(rpc.call("get_tree", json!({})).await.is_err());
    assert!(started.elapsed() < Duration::from_secs(10));
    rpc.close().await;

    // `/vibe` and empty side questions answer before any process starts.
    assert!(matches!(
        show(at(""), "vibe").await,
        Ok(Output::Done { .. })
    ));
    assert!(show(at(""), "btw").await.is_err());
}
