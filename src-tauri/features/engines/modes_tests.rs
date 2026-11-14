use super::*;
use serde_json::json;

const ENGINE: &[EngineMode] = &[
    mode("default", "Default", ModeKind::Asks, "manual"),
    mode("accept", "Accept edits", ModeKind::Edits, "auto"),
    mode("plan", "Plan", ModeKind::Plans, "plan"),
    mode("yolo", "YOLO", ModeKind::NoAsking, "bypass"),
];

#[test]
fn a_named_mode_is_found_by_its_id_and_an_unknown_one_refused() {
    assert_eq!(chosen(ENGINE, "accept", None).unwrap().launch, "auto");
    assert_eq!(
        chosen(ENGINE, " plan ", None).unwrap().kind,
        ModeKind::Plans
    );
    assert!(chosen(ENGINE, "bypass", None).is_err());
    assert!(chosen(ENGINE, "auto", Some(ModeKind::Edits)).is_err());
}

#[test]
fn an_old_choice_takes_the_closest_mode_that_asks_no_less() {
    let only_asks = &ENGINE[..1];
    assert_eq!(
        chosen(ENGINE, "", ModeKind::of_legacy("auto")).unwrap().id,
        "accept"
    );
    assert_eq!(
        chosen(ENGINE, "", ModeKind::of_legacy("bypass"))
            .unwrap()
            .id,
        "yolo"
    );
    assert_eq!(chosen(ENGINE, "", None).unwrap().id, "default");
    assert_eq!(
        chosen(only_asks, "", ModeKind::of_legacy("bypass"))
            .unwrap()
            .id,
        "default"
    );
    assert_eq!(
        chosen(only_asks, "", ModeKind::of_legacy("plan"))
            .unwrap()
            .id,
        "default"
    );
    let no_asks = &ENGINE[1..3];
    // An engine that can't ask runs an old Ask in its own first mode.
    assert_eq!(
        chosen(no_asks, "", ModeKind::of_legacy("ask")).unwrap().id,
        "accept"
    );
    assert!(chosen(&[], "", None).is_err());
}

#[test]
fn a_no_asking_mode_is_offered_only_with_the_folder_sandbox() {
    assert_eq!(offered_from(ENGINE, true).len(), 4);
    assert!(offered_from(ENGINE, false)
        .iter()
        .all(|mode| mode.kind != ModeKind::NoAsking));
    assert_eq!(launch_levels(ENGINE, false), ["manual", "auto", "plan"]);
}

#[test]
fn a_mode_reaches_the_app_as_id_label_and_kind() {
    assert_eq!(
        serde_json::to_value(ENGINE[3]).unwrap(),
        json!({ "id": "yolo", "label": "YOLO", "kind": "no_asking" })
    );
    assert_eq!(offered_by_id(""), MISTY_MODES);
    assert!(offered_by_id("nope").is_empty());
}

#[test]
fn reads_each_cli_help_list_of_modes() {
    // Claude Code: quoted, in parentheses, wrapped over lines.
    let claude = r#"
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
  --plugin-dir <path>                   Load plugins
"#;
    assert_eq!(
        parse_help_choices(claude, "--permission-mode").unwrap(),
        [
            "acceptEdits",
            "auto",
            "bypassPermissions",
            "manual",
            "dontAsk",
            "plan"
        ]
    );
    // CodeBuddy: one sentence, with longer flags that start the same name after it.
    let codebuddy = "  --permission-mode <mode>   Default permission mode. Choices: acceptEdits, \
        bypassPermissions, default, plan, dontAsk, auto. Does not write settings.\n  \
        --permission-mode-before-plan <mode>   Mode to restore\n";
    assert_eq!(
        parse_help_choices(codebuddy, "--permission-mode").unwrap(),
        [
            "acceptEdits",
            "bypassPermissions",
            "default",
            "plan",
            "dontAsk",
            "auto"
        ]
    );
    // Qoder: unquoted, wrapped.
    let qoder = "  --permission-mode <mode>   Set the permission mode (choices:\n         \
        default, accept_edits,\n         bypass_permissions, dont_ask, auto)\n  \
        --dangerously-skip-permissions   Bypass\n";
    assert_eq!(
        parse_help_choices(qoder, "--permission-mode").unwrap(),
        [
            "default",
            "accept_edits",
            "bypass_permissions",
            "dont_ask",
            "auto"
        ]
    );
    assert_eq!(
        parse_help_choices("  --model <m>  A model", "--permission-mode"),
        None
    );
}
