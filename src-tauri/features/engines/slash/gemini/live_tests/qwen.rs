use super::*;

/// Qwen Code on a scratch home whose sign-in is a stand-in key for a closed local port: the
/// file commands, its ACP session (Ask mode really asks), its menu, and `/branch` on a
/// session that a local command (`/status`, no model call) put records in.
#[tokio::test]
#[ignore = "runs the installed Qwen Code CLI"]
async fn qwen_commands_on_a_scratch_home() {
    let scratch = scratch();
    let home = scratch.root.join("qhome");
    std::env::set_var("QWEN_HOME", &home);
    std::env::set_var("OPENAI_API_KEY", "misty-live-test-not-a-key");
    std::env::set_var("OPENAI_BASE_URL", "http://127.0.0.1:9/v1");
    write(
        &home.join("settings.json"),
        r#"{
  "security": { "auth": { "selectedType": "openai" } },
  "model": { "name": "misty-live-test" },
  "permissions": { "allow": ["Bash(git status)"], "deny": ["Bash(rm -rf *)"] }
}"#,
    );
    write(
        &scratch.folder.join(".qwen/settings.json"),
        r#"{ "permissions": { "ask": ["Edit"] } }"#,
    );
    write(
        &home.join("agents/reviewer.md"),
        "---\nname: reviewer\ndescription: Reviews the diff\n---\nYou review.\n",
    );
    write(
        &scratch.folder.join(".qwen/agents/tester.md"),
        "---\nname: tester\ndescription: Writes tests\n---\nYou test.\n",
    );
    write(&home.join("QWEN.md"), "# Mine\n");
    write(&scratch.folder.join("QWEN.md"), "# Project\nline\n");
    write(
        &scratch.folder.join(".qwen/commands/qfoo.toml"),
        "description = \"Qwen foo\"\nprompt = \"Say qfoo {{args}}\"\n",
    );

    let engine = crate::engines::gemini::qwen();
    crate::engines::reported::forget("qwen");
    let (mut spawned, session, result) = open_session(&engine, &scratch)
        .await
        .expect("Qwen Code opens a session");
    println!(
        "session {session}, mode {}",
        result["modes"]["currentModeId"]
    );
    // Ask mode starts in Qwen's `default`, not its classifier `auto`.
    assert_eq!(
        result.pointer("/modes/currentModeId"),
        Some(&json!("default"))
    );
    // A local command records the session without a model call.
    let killed = AtomicBool::new(false);
    let mut refuse = refuse_requests;
    let prompt = tokio::time::timeout(
        Duration::from_secs(60),
        spawned.acp.routed(
            "session/prompt",
            json!({ "sessionId": session, "prompt": [{ "type": "text", "text": "/status" }] }),
            None::<Duration>,
            &killed,
            Some(&session),
            &mut refuse,
        ),
    )
    .await
    .expect("/status answers")
    .expect("/status runs");
    println!("/status: {prompt}");
    acp::teardown(&mut spawned.child).await;

    let rows = menu("qwen");
    println!("{} menu rows", rows.len());
    let row = |name: &str| rows.iter().find(|row| row.0 == name).cloned();
    assert_eq!(row("qfoo").map(|row| row.2), Some("Qwen foo".to_string()));
    assert_eq!(
        row("extensions").and_then(|row| row.1).as_deref(),
        Some("list | manage | install | explore")
    );
    let skills = crate::engines::reported::report_of("qwen")
        .skills
        .unwrap_or_default();
    println!("{} skills; first {:?}", skills.len(), skills.first());
    assert!(!skills.is_empty() && skills.iter().all(|skill| !skill.description.is_empty()));

    let mut failed = Vec::new();
    for (name, args) in [
        ("agents", ""),
        ("memory", ""),
        ("permissions", ""),
        ("extensions", "explore"),
        ("extensions", "explore ClaudeCode"),
        ("extensions", "list"),
        ("upgrade", ""),
        ("setup-github", ""),
        ("recap", ""),
    ] {
        if show(context("qwen", &scratch, Some(&session), args), name)
            .await
            .is_err()
        {
            failed.push(format!("{name} {args}"));
        }
    }
    match show(
        context("qwen", &scratch, Some(&session), "keep it short"),
        "commit",
    )
    .await
    {
        Ok(Output::Send { text }) => assert!(text.ends_with("keep it short")),
        other => failed.push(format!("commit: {other:?}")),
    }
    assert!(failed.is_empty(), "failed: {failed:?}");
    let agents = info_text(
        &show(context("qwen", &scratch, None, ""), "agents")
            .await
            .unwrap(),
    );
    assert!(
        agents.contains("reviewer") && agents.contains("tester"),
        "{agents}"
    );
    let memory = info_text(
        &show(context("qwen", &scratch, None, ""), "memory")
            .await
            .unwrap(),
    );
    assert!(memory.contains("2 lines"), "{memory}");
    let rules = info_text(
        &show(context("qwen", &scratch, None, ""), "permissions")
            .await
            .unwrap(),
    );
    assert!(
        rules.contains("Bash(rm -rf *)") && rules.contains("\"Edit\""),
        "{rules}"
    );

    // `/branch` through Qwen's own extension method, in a fresh process as Misty runs it.
    match show(
        context("qwen", &scratch, Some(&session), "live branch"),
        "branch",
    )
    .await
    {
        Ok(Output::Fork {
            session: forked,
            title,
            ..
        }) => {
            assert_ne!(forked, session);
            assert!(title.unwrap_or_default().starts_with("live branch"));
        }
        other => panic!("branch: {other:?}"),
    }
    assert!(show(context("qwen", &scratch, None, ""), "branch")
        .await
        .is_err());

    let catalog = crate::engines::catalog::catalog_for(
        "qwen",
        &dirs::home_dir().unwrap(),
        Some(&scratch.folder),
    );
    assert!(catalog
        .commands
        .iter()
        .any(|item| item.name == "qfoo" && item.description == "Qwen foo"));
    crate::engines::reported::forget("qwen");
}
