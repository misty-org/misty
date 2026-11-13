use super::*;

#[test]
fn offers_space_tools_under_names_clients_accept() {
    let names: Vec<&str> = space_tools()
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(names.contains(&"note_read"));
    assert!(names.contains(&ASK_MISTY));
    assert!(names.iter().all(|name| name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')));
    // What an engine already does itself is not offered a second time, and neither is a tool
    // that reads a page with Misty's own model.
    for withheld in ["shell_run", "folder_read", "browser_act", "browser_extract"] {
        assert!(!names.contains(&withheld), "{withheld}");
    }
}

#[test]
fn offers_the_browser_only_to_a_run_it_was_attached_to() {
    let run = Caller {
        run_id: "r1".into(),
        browser: true,
        computer: false,
    };
    let plain = Caller {
        run_id: "r2".into(),
        browser: false,
        computer: false,
    };
    assert!(plain.offers(&json!({ "name": "note_read" })));
    // Without the Browser attachment a run has no browser at all.
    for name in ["screen_open", "browser_snapshot", "browser_steps"] {
        assert!(!plain.offers(&json!({ "name": name })), "{name}");
    }
    assert!(!plain.instructions().contains("screen_open"));
    assert!(run.instructions().contains("screen_open"));
    for name in ["screen_open", "browser_snapshot", "browser_steps"] {
        let tool = space_tools()
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("{name} is offered"));
        assert!(run.offers(tool));
    }
    let open = space_tools()
        .iter()
        .find(|tool| tool["name"] == "screen_open")
        .unwrap();
    // An engine's screen is a tab of its own, never the desktop or the person's tab.
    assert!(open["inputSchema"]["properties"]["target"].is_null());
    let (tool, input) = misty_call(
        "screen_open",
        json!({ "reason": "Read it", "target": "desktop" }),
    )
    .unwrap();
    assert_eq!(tool, "screen.open");
    assert!(input.get("target").is_none());
}

#[test]
fn maps_a_call_back_to_misty_s_own_tool() {
    assert_eq!(
        misty_call("note_read", json!({ "id": "n1" })),
        Some(("note.read".to_string(), json!({ "id": "n1" })))
    );
    let (tool, input) = misty_call(ASK_MISTY, json!({ "goal": "Book it" })).unwrap();
    assert_eq!(tool, "agent.delegate");
    assert_eq!(input["tasks"][0]["goal"], "Book it");
    assert_eq!(misty_call("shell_run", json!({})), None);
}

#[test]
fn knows_its_own_tools_however_an_engine_spells_them() {
    for spelled in [
        "mcp__misty__screen_open",
        "misty_browser_snapshot",
        "Misty: note_read",
    ] {
        assert!(names_misty_tool(spelled, &Value::Null), "{spelled}");
    }
    // An engine that only gives a title still describes the call it wants to make.
    let call =
        json!({ "title": "Open a tab", "rawInput": { "server": "misty", "tool": "screen_open" } });
    assert!(names_misty_tool("Open a tab", &call));
    for other in [
        "shell",
        "edit",
        "mcp__github__create_issue",
        "misty",
        "screen_open",
    ] {
        assert!(!names_misty_tool(other, &Value::Null), "{other}");
    }
}
