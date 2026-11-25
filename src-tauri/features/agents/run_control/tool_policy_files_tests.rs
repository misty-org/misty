use serde_json::json;

use super::*;

const CHANGES: &[&str] = &[
    "files.create_folder",
    "files.rename",
    "files.move",
    "files.copy",
    "files.trash",
    "files.tag",
    "files.zip",
    "files.extract",
];

const READS: &[&str] = &[
    "files.list",
    "files.search",
    "files.info",
    "files.read",
    "files.reveal",
];

fn every_mode(agent_delete: bool) -> Vec<RunFacts> {
    let facts = |auto: bool, bypass: bool, planning: bool| RunFacts {
        auto,
        bypass,
        planning,
        agent_delete,
        person_prompt: "tidy my downloads".into(),
        ..RunFacts::default()
    };
    vec![
        facts(false, false, false),
        facts(true, false, false),
        facts(true, true, false),
        facts(true, true, true),
        facts(false, false, true),
    ]
}

fn refused(decision: &Decision, wanted: &str) -> bool {
    matches!(decision, Decision::Refuse { code, .. } if *code == wanted)
}

#[test]
fn no_delete_without_the_switch_in_any_mode() {
    let taint = Taint::default();
    for facts in every_mode(false) {
        let decision = decide(&facts, &taint, "files.delete", &json!({ "paths": ["/x"] }));
        assert!(refused(&decision, "delete_off"), "{facts:?}");
    }
}

#[test]
fn delete_asks_in_every_mode_once_it_is_on() {
    let taint = Taint::default();
    for facts in every_mode(true).into_iter().filter(|facts| !facts.planning) {
        assert_eq!(
            decide(&facts, &taint, "files.delete", &json!({ "paths": ["/x"] })),
            Decision::Ask {
                kind: "delete",
                why: "A deleted file can't be recovered.".to_owned()
            },
            "{facts:?}"
        );
    }
    let planning = every_mode(true)
        .into_iter()
        .find(|facts| facts.planning)
        .unwrap();
    assert!(refused(
        &decide(&planning, &taint, "files.delete", &json!({})),
        "plan_mode"
    ));
}

#[test]
fn any_other_delete_like_tool_is_refused_even_with_the_switch_on() {
    let taint = Taint::default();
    for facts in every_mode(true) {
        for name in [
            "files.remove",
            "files.purge",
            "disk.rm",
            "folder_unlink",
            "notes.erase_all",
        ] {
            assert!(
                refused(&decide(&facts, &taint, name, &json!({})), "delete_off"),
                "{name}"
            );
        }
    }
    assert!(!deletes("item.delete"));
    assert!(!deletes("browser.fill_form"));
    assert!(!deletes("app.notes.delete_note"));
    assert!(deletes("files.delete"));
}

#[test]
fn plan_mode_refuses_every_change_and_reads_run() {
    let taint = Taint::default();
    let planning = RunFacts {
        planning: true,
        auto: true,
        bypass: true,
        ..RunFacts::default()
    };
    for name in CHANGES {
        assert!(
            refused(&decide(&planning, &taint, name, &json!({})), "plan_mode"),
            "{name}"
        );
    }
    for name in READS {
        assert_eq!(
            decide(&planning, &taint, name, &json!({})),
            Decision::Run,
            "{name}"
        );
    }
}

#[test]
fn changes_ask_unless_the_engine_asks_nothing() {
    let taint = Taint::default();
    let asking = RunFacts::default();
    let edits = RunFacts {
        auto: true,
        ..RunFacts::default()
    };
    let no_asking = RunFacts {
        auto: true,
        bypass: true,
        ..RunFacts::default()
    };
    for name in CHANGES {
        assert!(
            matches!(
                decide(&asking, &taint, name, &json!({})),
                Decision::Ask { .. }
            ),
            "{name}"
        );
        assert!(
            matches!(
                decide(&edits, &taint, name, &json!({})),
                Decision::Ask { .. }
            ),
            "{name}"
        );
        assert_eq!(
            decide(&no_asking, &taint, name, &json!({})),
            Decision::Run,
            "{name}"
        );
    }
    for name in READS {
        assert_eq!(
            decide(&asking, &taint, name, &json!({})),
            Decision::Run,
            "{name}"
        );
    }
}

#[test]
fn files_trash_never_deletes_outright() {
    let tool = include_str!("../../files/agent_tools_changes.rs");
    let moves = include_str!("../../files/agent_trash.rs");
    assert!(tool.contains("move_to_trash_for_agent("));
    assert!(moves.contains(".in_trash("));
    let direct = ["trash", "::delete("].concat();
    for source in [tool, moves] {
        assert!(!source.contains(direct.as_str()));
    }
}

#[test]
fn the_delete_switch_comes_from_the_device_never_the_request() {
    let facts = RunFacts::of_request(
        "r",
        &json!({ "agent_delete": true, "permission_mode": "bypass" }),
    );
    assert!(!facts.agent_delete);
}
