use super::*;
use serde_json::json;

fn info(output: Output) -> (String, Vec<Section>) {
    match output {
        Output::Info { title, sections } => (title, sections),
        other => panic!("not facts: {other:?}"),
    }
}

/// `/usage` as agy 1.5.9 prints it signed in (trimmed): its rows, and the quota's own words.
#[test]
fn usage_shows_each_limit_as_a_row() {
    let result = json!({"conversation_id": "", "status": "SUCCESS",
        "response": "Gemini Models\tWeekly Limit Remaining\t98%\t2026-11-21T07:24:20Z\nClaude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-14T13:23:21Z\n",
        "num_turns": 0,
        "command": {"name": "usage", "data": {"description": "Within each group, models share a weekly limit and a 5-hour limit.", "groups": []}}});
    let (title, sections) = info(shown("Antigravity usage", &result).unwrap());
    assert_eq!(title, "Antigravity usage");
    assert_eq!(sections[0].rows.len(), 2);
    assert_eq!(sections[0].rows[0].label, "Gemini Models");
    assert_eq!(
        sections[0].rows[0].value,
        "Weekly Limit Remaining · 98% · 2026-11-21T07:24:20Z"
    );
    assert!(sections[1]
        .text
        .as_deref()
        .unwrap()
        .starts_with("Within each group"));
}

#[test]
fn credits_and_empty_lists_read_plainly() {
    let credits = json!({"status": "SUCCESS",
        "response": "Remaining credits\t0\nUpgrade\thttps://antigravity.google/g1-upgrade\n",
        "command": {"name": "credits", "data": {"remaining_credits": 0, "upgrade_uri": "https://antigravity.google/g1-upgrade"}}});
    let (_, sections) = info(shown("Antigravity credits", &credits).unwrap());
    assert_eq!(sections[0].rows[0].value, "0");
    let hooks = json!({"status": "SUCCESS", "response": "", "command": {"name": "hooks", "data": {"hooks": []}}});
    let (_, sections) = info(shown("Antigravity hooks", &hooks).unwrap());
    assert_eq!(sections[0].text.as_deref(), Some("None set up yet."));
    let changelog =
        json!({"status": "SUCCESS", "response": "# Antigravity CLI Changelog\n\n## 1.5.9\n"});
    let (_, sections) = info(shown("Antigravity changelog", &changelog).unwrap());
    assert!(sections[0].text.as_deref().unwrap().contains("## 1.5.9"));
    let failed = json!({"status": "ERROR", "error": "You are not logged into Antigravity."});
    assert_eq!(
        shown("Antigravity usage", &failed).unwrap_err(),
        "You are not logged into Antigravity."
    );
}

#[test]
fn local_commands_run_in_print_mode_and_grill_me_is_listed() {
    assert_eq!(
        print_args("usage", ""),
        [
            "--output-format",
            "stream-json",
            "--mode",
            "plan",
            "--print-timeout",
            "1m",
            "--print",
            "/usage"
        ]
    );
    let names = |runs| {
        COMMANDS
            .iter()
            .filter(|command| command.runs == runs)
            .map(|command| command.name)
            .collect::<Vec<_>>()
    };
    assert!(names(super::super::Runs::Turn).contains(&"grill-me"));
    assert_eq!(
        names(super::super::Runs::Misty),
        [
            "plugin",
            "usage",
            "credits",
            "skills",
            "agents",
            "hooks",
            "changelog"
        ]
    );
}

/// Misty's out-of-turn commands against the installed, signed-in CLI; none calls a model:
/// `cargo test --lib agy_local_commands_live -- --ignored --nocapture`.
#[cfg(unix)]
#[tokio::test]
#[ignore = "runs the installed Antigravity CLI"]
async fn agy_local_commands_live() {
    // SAFETY: getpwuid returns the calling user's static record, read before anything else.
    let home = unsafe {
        let record = libc::getpwuid(libc::getuid());
        std::ffi::CStr::from_ptr((*record).pw_dir)
            .to_string_lossy()
            .into_owned()
    };
    std::env::set_var("HOME", &home);
    let dir = tempfile::tempdir().unwrap();
    for name in COMMANDS
        .iter()
        .filter(|command| command.runs == super::super::Runs::Misty)
        .map(|command| command.name)
    {
        let context = Context {
            engine: "agy".into(),
            account: "live-test".into(),
            conversation: "live-test".into(),
            folder: Some(dir.path().to_path_buf()),
            session: None,
            args: String::new(),
            db: database::store::Store::at(dir.path().join("misty.db")),
        };
        let output = run(context, name).await;
        let shown = match &output {
            Ok(output) => serde_json::to_string(output).unwrap(),
            Err(error) => format!("ERROR: {error}"),
        };
        println!("/{name}: {}", shown.chars().take(400).collect::<String>());
        assert!(output.is_ok(), "/{name}");
    }
}
