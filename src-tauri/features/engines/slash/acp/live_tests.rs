use super::*;
use crate::engines::slash::run as run_command;

/// The test binary points HOME at a scratch folder; Misty's settings, which name where
/// Hermes is installed, live in the person's real one.
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

fn context(
    folder: &Path,
    session: Option<&str>,
    args: &str,
    db: &database::store::Store,
) -> Context {
    Context {
        engine: "hermes".into(),
        account: "live-test".into(),
        conversation: "live-test".into(),
        folder: Some(folder.to_path_buf()),
        session: session.map(str::to_string),
        args: args.into(),
        db: db.clone(),
    }
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

/// Two checkpoints of `folder`, taken by Hermes's own checkpoint manager in its own Python
/// (the virtualenv Hermes made under the home); why not, when it can't.
fn take_checkpoints(home: &Path, folder: &Path) -> Result<(), String> {
    // `hermes --version` names its checkout ("Install directory: …"); the launcher Misty
    // finds may be a shim elsewhere.
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "hermes");
    let version = std::process::Command::new(&bin)
        .arg("--version")
        .env("HERMES_HOME", home)
        .output()
        .map_err(|error| format!("{bin}: {error}"))?;
    let repo = String::from_utf8_lossy(&version.stdout)
        .lines()
        .find_map(|line| line.strip_prefix("Install directory:"))
        .map(|dir| PathBuf::from(dir.trim()))
        .filter(|dir| dir.join("tools/checkpoint_manager.py").exists())
        .ok_or(format!("{bin} --version names no Hermes checkout"))?;
    let python = std::fs::read_dir(home.join("installs"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|install| {
            std::fs::read_dir(install.path().join("environments"))
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|environment| environment.path().join("venv/bin/python3"))
        .find(|python| python.exists())
        .ok_or("no Hermes virtualenv under the home")?;
    let script = "import sys, time\nsys.path.insert(0, sys.argv[1])\n\
        from tools.checkpoint_manager import CheckpointManager\n\
        d = sys.argv[2]\nm = CheckpointManager(enabled=True)\n\
        assert m.ensure_checkpoint(d, 'before write_file a.txt')\n\
        open(d + '/a.txt', 'w').write('two\\nmore\\n')\nm.new_turn()\ntime.sleep(1.1)\n\
        assert m.ensure_checkpoint(d, 'before patch a.txt')\n";
    let run = std::process::Command::new(&python)
        .args(["-c", script])
        .arg(repo)
        .arg(folder)
        .env("HERMES_HOME", home)
        .output()
        .map_err(|error| format!("{}: {error}", python.display()))?;
    if run.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&run.stderr).into_owned())
    }
}

fn engine_context(
    engine: &str,
    folder: &Path,
    session: Option<&str>,
    args: &str,
    db: &database::store::Store,
) -> Context {
    Context {
        engine: engine.into(),
        ..context(folder, session, args, db)
    }
}

/// A scratch project folder and Misty store.
fn project() -> (tempfile::TempDir, PathBuf, database::store::Store) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("project")).unwrap();
    let folder = dir.path().join("project").canonicalize().unwrap();
    let db = database::store::Store::at(dir.path().join("misty.db"));
    (dir, folder, db)
}

/// `session/new` on the engine's ACP server, launched as Misty launches it out of turn.
async fn new_session(context: &Context, folder: &Path) -> (Value, String) {
    let mut live = OutOfTurn::open(context, folder).await.unwrap();
    let agent = live.agent.clone();
    let created = live
        .call(
            "session/new",
            json!({ "cwd": live.cwd(), "mcpServers": [] }),
            SESSION_NEW_TIMEOUT,
        )
        .await;
    live.close().await;
    let created = created.unwrap();
    let session = text(&created, "sessionId").expect("a session id");
    (agent, session)
}

#[tokio::test]
#[ignore = "runs the installed Kimi Code on a scratch home with an env channel on a closed port"]
async fn kimi_fork_on_a_scratch_home() {
    use_real_home();
    let (dir, folder, db) = project();
    std::env::set_var("KIMI_CODE_HOME", dir.path().join("kimi-home"));
    std::env::set_var("KIMI_CODE_NO_AUTO_UPDATE", "1");
    for (key, value) in [
        ("KIMI_MODEL_NAME", "probe-model"),
        ("KIMI_MODEL_API_KEY", "fake-probe"),
        ("KIMI_MODEL_PROVIDER_TYPE", "openai"),
        ("KIMI_MODEL_BASE_URL", "http://127.0.0.1:9/v1"),
    ] {
        std::env::set_var(key, value);
    }
    let at =
        |session: Option<&str>, args: &str| engine_context("kimi", &folder, session, args, &db);
    let (agent, session) = new_session(&at(None, ""), &folder).await;
    assert_eq!(agent["agentInfo"]["name"], "Kimi Code CLI", "{agent}");
    let forked = show(at(Some(&session), "Kimi side"), "fork").await.unwrap();
    assert!(
        matches!(&forked, Output::Fork { session: fork, title: Some(title), .. }
            if *fork != session && title == "Kimi side"),
        "{forked:?}"
    );
}

#[tokio::test]
#[ignore = "runs the installed Grok on a scratch home with a fake key and closed ports"]
async fn grok_fork_rename_and_status_on_a_scratch_home() {
    use_real_home();
    let (dir, folder, db) = project();
    std::env::set_var("GROK_HOME", dir.path().join("grok-home"));
    std::env::set_var("XAI_API_KEY", "xai-fake-probe");
    std::env::set_var("GROK_XAI_API_BASE_URL", "http://127.0.0.1:9");
    std::env::set_var("GROK_CLI_CHAT_PROXY_BASE_URL", "http://127.0.0.1:9");
    let at =
        |session: Option<&str>, args: &str| engine_context("grok", &folder, session, args, &db);
    let (agent, session) = new_session(&at(None, ""), &folder).await;
    assert!(agent["_meta"]["agentVersion"].as_str().is_some(), "{agent}");

    let Output::Info { sections, .. } = show(at(Some(&session), ""), "status").await.unwrap()
    else {
        panic!("/status shows the session");
    };
    let rows = &sections[0].rows;
    assert!(rows
        .iter()
        .any(|row| row.label == "Session" && row.value == session));
    assert!(rows.iter().any(|row| row.label == "Context"));

    let renamed = show(at(Some(&session), "Probe title"), "rename")
        .await
        .unwrap();
    assert!(matches!(&renamed, Output::Rename { title } if title == "Probe title"));
    assert!(show(at(Some(&session), ""), "rename").await.is_err());

    let forked = show(at(Some(&session), ""), "fork").await.unwrap();
    assert!(
        matches!(&forked, Output::Fork { session: fork, title: None, .. } if *fork != session),
        "{forked:?}"
    );
}

#[tokio::test]
#[ignore = "runs the installed MiniMax Code on a scratch data folder with a provider on a closed port"]
async fn minimax_fork_on_a_scratch_home() {
    use_real_home();
    let (dir, folder, db) = project();
    let data = dir.path().join("mcode-home");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(
        data.join("config.yaml"),
        "defaultModel: probe/probe-model\ncustom_provider:\n  probe:\n    name: probe\n    kind: custom\n    enabled: true\n    api: openai-completions\n    options:\n      apiKey: fake-probe\n      baseURL: http://127.0.0.1:9/v1\n      authMode: api-key\n    models:\n      probe-model:\n        reasoning: false\n",
    )
    .unwrap();
    std::env::set_var("MINIMAX_DATA_DIR", &data);
    std::env::set_var("MCODE_CONFIG_DIR", &data);
    let at =
        |session: Option<&str>, args: &str| engine_context("minimax", &folder, session, args, &db);
    let (agent, session) = new_session(&at(None, ""), &folder).await;
    assert_eq!(agent["agentInfo"]["name"], "minimax-code", "{agent}");
    // mcode forks only at a finished reply, and this session has none.
    assert_eq!(
        show(at(Some(&session), ""), "fork").await.unwrap_err(),
        "MiniMax Code forks a session only after a reply has finished."
    );
}

#[tokio::test]
#[ignore = "runs the installed Hermes on MISTY_TEST_HERMES_HOME; no model is reached"]
async fn hermes_commands_on_a_scratch_home() {
    let home = PathBuf::from(
        std::env::var_os("MISTY_TEST_HERMES_HOME").expect("set MISTY_TEST_HERMES_HOME"),
    );
    use_real_home();
    std::env::set_var("HERMES_HOME", &home);
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("project")).unwrap();
    let folder = dir.path().join("project").canonicalize().unwrap();
    std::fs::write(folder.join("a.txt"), "one\n").unwrap();
    let db = database::store::Store::at(dir.path().join("misty.db"));
    let at = |session: Option<&str>, args: &str| context(&folder, session, args, &db);

    // A session, opened the way Misty opens one out of turn.
    let mut live = OutOfTurn::open(&at(None, ""), &folder).await.unwrap();
    assert!(live.can("fork") && live.can("resume"), "{}", live.agent);
    let created = live
        .call(
            "session/new",
            json!({ "cwd": live.cwd(), "mcpServers": [] }),
            SESSION_NEW_TIMEOUT,
        )
        .await;
    live.close().await;
    let session = text(&created.unwrap(), "sessionId").expect("a session id");

    let forked = show(at(Some(&session), "Side"), "fork").await.unwrap();
    assert!(
        matches!(&forked, Output::Fork { session: fork, title: Some(title), prompt: None }
            if *fork != session && title == "Side"),
        "{forked:?}"
    );
    let background = show(at(Some(&session), "write the docs"), "bg")
        .await
        .unwrap();
    assert!(
        matches!(&background, Output::Fork { prompt: Some(prompt), .. } if prompt == "write the docs")
    );

    assert!(matches!(
        show(at(Some(&session), ""), "save").await,
        Ok(Output::Info { .. })
    ));
    for (args, file) in [
        ("json probe.json", "probe.json"),
        ("md probe.md", "probe.md"),
        ("html probe.html redact", "probe.html"),
    ] {
        show(at(Some(&session), args), "save").await.unwrap();
        let written = std::fs::read_to_string(folder.join(file)).unwrap();
        assert!(!written.trim().is_empty(), "{file}");
        if file == "probe.json" {
            let snapshot: Value = serde_json::from_str(&written).unwrap();
            assert_eq!(snapshot["id"], session.as_str());
        }
    }
    assert!(show(at(Some(&session), "pdf"), "save").await.is_err());

    let Output::Info { sections, .. } = show(at(Some(&session), ""), "rollback").await.unwrap()
    else {
        panic!("/rollback lists checkpoints");
    };
    assert!(sections[0].rows.is_empty());
    let taken = take_checkpoints(&home, &folder);
    if taken.is_ok() {
        let Output::Info { sections, .. } = show(at(Some(&session), ""), "rollback").await.unwrap()
        else {
            panic!("/rollback lists checkpoints");
        };
        let rows: Vec<&str> = sections[0]
            .rows
            .iter()
            .map(|row| row.value.as_str())
            .collect();
        assert_eq!(rows.len(), 2, "{rows:?}");
        assert!(rows[0].contains("before patch a.txt") && rows[0].contains("1 file changed"));
        assert!(rows[1].contains("before write_file a.txt"));
    } else {
        println!("(checkpoints not taken: {})", taken.unwrap_err());
    }
    assert!(matches!(
        show(at(Some(&session), "1"), "rollback").await,
        Ok(Output::Done { .. })
    ));

    let Output::Info { sections, .. } = show(at(None, ""), "agents").await.unwrap() else {
        panic!("/agents lists processes");
    };
    let running = sections[0].rows.len();
    assert_eq!(
        sections[0].heading.as_deref(),
        Some(format!("Running processes ({running})").as_str())
    );
    assert!(matches!(
        show(at(None, ""), "reload-mcp").await,
        Ok(Output::Done { .. })
    ));
    assert!(show(at(Some(&session), ""), "btw").await.is_err());
}
