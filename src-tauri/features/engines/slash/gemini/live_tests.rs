#![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde_json::{json, Value};

use super::super::{run, Context, Output};
use super::chat::project_temp_dirs;
use super::qwen::refuse_requests;
use crate::engines::qoder_session::{self as acp, SpawnedAcp};
use crate::engines::{Engine, SendRequest};

mod qwen;

struct Scratch {
    _dir: tempfile::TempDir,
    root: PathBuf,
    folder: PathBuf,
    extra: PathBuf,
    db: database::store::Store,
}

/// The test binary points HOME at a scratch folder (`isolate_for_tests`); the CLIs' files
/// live in the person's real one, which their account record names.
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
    for key in [
        "GEMINI_CLI_HOME",
        "GEMINI_CLI_TRUSTED_FOLDERS_PATH",
        "GEMINI_CLI_SYSTEM_SETTINGS_PATH",
        "GEMINI_CLI_TRUST_WORKSPACE",
        "GEMINI_API_KEY",
        "QWEN_HOME",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
    ] {
        std::env::remove_var(key);
    }
    let dir = tempfile::tempdir().expect("a scratch folder");
    let root = dir.path().canonicalize().unwrap();
    let folder = root.join("project");
    let extra = root.join("extra");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::create_dir_all(&extra).unwrap();
    let db = database::store::Store::at(root.join("misty.db"));
    Scratch {
        _dir: dir,
        root,
        folder,
        extra,
        db,
    }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn context(engine: &str, scratch: &Scratch, session: Option<&str>, args: &str) -> Context {
    Context {
        engine: engine.into(),
        account: "live-test".into(),
        conversation: "live-test".into(),
        folder: Some(scratch.folder.clone()),
        session: session.map(str::to_string),
        args: args.into(),
        db: scratch.db.clone(),
    }
}

async fn show(context: Context, name: &str) -> Result<Output, String> {
    let label = format!("/{name} {}", context.args);
    let engine = context.engine.clone();
    let outcome = run(context, name).await;
    let shown = match &outcome {
        Ok(output) => serde_json::to_string_pretty(output).unwrap(),
        Err(error) => format!("ERROR: {error}"),
    };
    println!("\n===== {engine} {label}\n{shown}");
    outcome
}

fn info_text(output: &Output) -> String {
    serde_json::to_string(output).unwrap()
}

/// The engine started as the adapter starts it for a turn in Ask mode, with the scratch's
/// extra folder added, then `initialize` and `session/new`. A `session/set_mode` to the mode
/// it already has reads on past the commands the CLI announces once the session is open.
async fn open_session(
    engine: &dyn Engine,
    scratch: &Scratch,
) -> Result<(SpawnedAcp, String, Value), String> {
    let req = SendRequest {
        session_id: None,
        workspace: scratch.folder.clone(),
        prompt: String::new(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: None,
        effort: None,
        service_tier: None,
        permission: Some("manual".into()),
        additional_dirs: vec![scratch.extra.to_string_lossy().into_owned()],
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    };
    let mut built = engine.host_command(&req, engine.id())?;
    let args: Vec<String> = built
        .command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    println!("\n===== {} {args:?}", engine.id());
    let mut spawned = acp::spawn_piped_acp(&mut built.command, engine.id(), &scratch.folder)?;
    spawned.acp.reports_as = Some(engine.id().to_string());
    let killed = AtomicBool::new(false);
    let mut refuse = refuse_requests;
    let client = &mut spawned.acp;
    client
        .routed(
            "initialize",
            acp::initialize_params(),
            acp::RPC_HANDSHAKE_TIMEOUT,
            &killed,
            None,
            &mut refuse,
        )
        .await?;
    let result = client
        .routed(
            "session/new",
            json!({ "cwd": scratch.folder.to_string_lossy(), "mcpServers": [] }),
            acp::SESSION_NEW_TIMEOUT,
            &killed,
            None,
            &mut refuse,
        )
        .await?;
    let session = result["sessionId"].as_str().unwrap_or_default().to_string();
    let mode = result
        .pointer("/modes/currentModeId")
        .cloned()
        .unwrap_or(json!("default"));
    tokio::time::sleep(Duration::from_millis(500)).await;
    client
        .routed(
            "session/set_mode",
            json!({ "sessionId": session, "modeId": mode }),
            acp::RPC_HANDSHAKE_TIMEOUT,
            &killed,
            None,
            &mut refuse,
        )
        .await?;
    Ok((spawned, session, result))
}

fn menu(engine: &str) -> Vec<(String, Option<String>, String)> {
    crate::engines::reported::report_of(engine)
        .commands
        .unwrap_or_default()
        .into_iter()
        .map(|named| (named.name, named.argument_hint, named.description))
        .collect()
}

/// Gemini CLI's file commands on the person's real `~/.gemini`, read only.
#[tokio::test]
#[ignore = "reads the installed Gemini CLI's files"]
async fn gemini_commands_on_the_real_home() {
    let scratch = scratch();
    let mut failed = Vec::new();
    for (name, args) in [
        ("commands", ""),
        ("chat", "list"),
        ("hooks", ""),
        ("policies", ""),
        ("permissions", ""),
        ("permissions", "trust"),
        ("permissions", "trust ~/misty-org/misty/src-tauri"),
        ("restore", ""),
        ("restore", "list"),
        ("privacy", ""),
        ("upgrade", ""),
        ("docs", ""),
        ("bug", "Menu shows nothing"),
    ] {
        if show(context("gemini", &scratch, None, args), name)
            .await
            .is_err()
        {
            failed.push(format!("{name} {args}"));
        }
    }
    assert!(failed.is_empty(), "failed: {failed:?}");
}

/// Gemini CLI on a scratch home Misty fills in: its real ACP session registers the scratch
/// project (and its checkpoint folder), and every file command reads what was put there.
#[tokio::test]
#[ignore = "runs the installed Gemini CLI"]
async fn gemini_commands_on_a_scratch_home() {
    let scratch = scratch();
    let home = scratch.root.join("ghome");
    let gemini_dir = home.join(".gemini");
    std::env::set_var("GEMINI_CLI_HOME", &home);
    std::env::set_var(
        "GEMINI_CLI_SYSTEM_SETTINGS_PATH",
        scratch.root.join("system.json"),
    );
    // A stand-in key: Gemini CLI opens a session with any key, and no call is made.
    std::env::set_var("GEMINI_API_KEY", "misty-live-test-not-a-key");
    let folder = scratch.folder.to_string_lossy().into_owned();
    // Gemini CLI writes its trust rules in lower case on macOS.
    let rule = if cfg!(target_os = "macos") {
        folder.to_lowercase()
    } else {
        folder.clone()
    };
    write(
        &gemini_dir.join("trustedFolders.json"),
        &json!({ rule: "TRUST_FOLDER" }).to_string(),
    );
    write(
        &gemini_dir.join("settings.json"),
        r#"{
  // The user's own, with a comment as Gemini CLI allows.
  "security": { "auth": { "selectedType": "gemini-api-key" } },
  "hooks": { "BeforeTool": [{ "matcher": "run_shell_command", "hooks": [{ "type": "command", "command": "echo before", "name": "audit" }] }] },
  "hooksConfig": { "disabled": ["audit"] }
}"#,
    );
    write(
        &scratch.folder.join(".gemini/settings.json"),
        r#"{ "hooks": { "AfterAgent": [{ "hooks": [{ "type": "command", "command": "echo after" }] }] } }"#,
    );
    write(
        &gemini_dir.join("commands/ufoo.toml"),
        "description = \"\"\"Says foo\nfrom the user\"\"\"\nprompt = \"Say foo {{args}}\"\n",
    );
    write(
        &scratch.folder.join(".gemini/commands/foo.toml"),
        "description = \"Project foo\"\nprompt = \"Say project foo\"\n",
    );
    write(
        &scratch.folder.join(".gemini/commands/git/sync.toml"),
        "prompt = \"Sync\"\n",
    );
    write(
        &gemini_dir.join("policies/mine.toml"),
        "[[rule]]\ntoolName = \"run_shell_command\"\ncommandPrefix = \"git push\"\ndecision = \"ask_user\"\npriority = 100\n",
    );

    // The real session, as the adapter starts it.
    let engine = crate::engines::gemini::gemini();
    crate::engines::reported::forget("gemini");
    let (mut spawned, session, result) = open_session(&engine, &scratch)
        .await
        .expect("Gemini CLI opens a session");
    acp::teardown(&mut spawned.child).await;
    println!("session {session}, modes {}", result["modes"]);
    assert_eq!(
        result.pointer("/modes/currentModeId"),
        Some(&json!("default"))
    );
    let rows = menu("gemini");
    for row in &rows {
        println!("menu row: /{} {:?} — {}", row.0, row.1, row.2);
    }
    let hint = |name: &str| {
        rows.iter()
            .find(|row| row.0 == name)
            .and_then(|row| row.1.clone())
            .unwrap_or_default()
    };
    assert_eq!(hint("memory"), "show | refresh | list | inbox");
    assert!(
        hint("extensions").ends_with("| restart | update"),
        "{}",
        hint("extensions")
    );
    assert_eq!(hint("restore"), "list");
    assert!(!rows.iter().any(|row| row.0.contains(' ')));

    // The checkpoint folder Gemini CLI made for the project, found as `/chat` finds it.
    let dirs = project_temp_dirs(&scratch.folder);
    println!("checkpoint folders: {dirs:?}");
    let tmp = dirs.first().expect("Gemini CLI registered the project");
    write(&tmp.join("checkpoint-my%20tag.json"), "[]");
    write(&tmp.join("checkpoint-old.json"), "[]");

    let mut failed = Vec::new();
    for (name, args) in [
        ("commands", ""),
        ("chat", ""),
        ("chat", "delete my tag"),
        ("chat", "list"),
        ("chat", "save x"),
        ("chat", "delete nothing-here"),
        ("hooks", ""),
        ("policies", ""),
        ("permissions", "trust"),
        ("permissions", "trust ../extra"),
        ("permissions", "trust no-such-folder"),
        ("restore", ""),
        ("privacy", ""),
        ("upgrade", ""),
    ] {
        let expect_error = matches!((name, args), ("chat", "save x" | "delete nothing-here"))
            || args == "trust no-such-folder";
        match show(context("gemini", &scratch, Some(&session), args), name).await {
            Ok(_) if expect_error => failed.push(format!("{name} {args} (no error)")),
            Err(_) if !expect_error => failed.push(format!("{name} {args}")),
            _ => {}
        }
    }
    assert!(failed.is_empty(), "failed: {failed:?}");

    let commands = info_text(
        &show(context("gemini", &scratch, None, ""), "commands")
            .await
            .unwrap(),
    );
    for expected in [
        "/ufoo",
        "Says foo from the user",
        "/foo",
        "Project foo",
        "/git:sync",
    ] {
        assert!(commands.contains(expected), "{expected}: {commands}");
    }
    let chats = info_text(
        &show(context("gemini", &scratch, None, "list"), "chat")
            .await
            .unwrap(),
    );
    assert!(
        chats.contains("old") && !chats.contains("my tag"),
        "{chats}"
    );
    let trust = info_text(
        &show(context("gemini", &scratch, None, "trust"), "permissions")
            .await
            .unwrap(),
    );
    assert!(trust.contains("\"Trusted\""), "{trust}");
    let hooks = info_text(
        &show(context("gemini", &scratch, None, ""), "hooks")
            .await
            .unwrap(),
    );
    assert!(
        hooks.contains("audit: echo before") && hooks.contains("echo after"),
        "{hooks}"
    );
    let policies = info_text(
        &show(context("gemini", &scratch, None, ""), "policies")
            .await
            .unwrap(),
    );
    assert!(
        policies.contains("run_shell_command · git push"),
        "{policies}"
    );

    // `/restore` with checkpointing off, then on in the trusted project's settings.
    let off = info_text(
        &show(context("gemini", &scratch, None, ""), "restore")
            .await
            .unwrap(),
    );
    assert!(off.contains("\"Off\""), "{off}");
    write(
        &scratch.folder.join(".gemini/settings.json"),
        r#"{ "general": { "checkpointing": { "enabled": true } } }"#,
    );
    match show(context("gemini", &scratch, None, "list"), "restore").await {
        Ok(Output::Send { text }) => assert_eq!(text, "/restore list"),
        other => panic!("restore list: {other:?}"),
    }

    // The `/` menu: the custom commands with their descriptions, over the engine's report.
    let catalog = crate::engines::catalog::catalog_for(
        "gemini",
        &dirs::home_dir().unwrap(),
        Some(&scratch.folder),
    );
    for item in &catalog.commands {
        println!(
            "catalog: /{} [{}] {:?} — {}",
            item.name, item.source, item.argument_hint, item.description
        );
    }
    let item = |name: &str| catalog.commands.iter().find(|item| item.name == name);
    assert_eq!(
        item("foo").map(|i| (i.source, i.description.as_str())),
        Some(("project", "Project foo"))
    );
    assert_eq!(
        item("ufoo").map(|i| i.description.as_str()),
        Some("Says foo from the user")
    );
    assert_eq!(
        item("git:sync").map(|i| i.description.as_str()),
        Some("Custom command from sync.toml")
    );
    assert_eq!(
        item("restore").map(|i| i.runs),
        Some(super::super::Runs::Misty)
    );
    crate::engines::reported::forget("gemini");
}
