use super::omfg::{balanced_object, omfg_prompt, parse_rule, rule_name};
use super::omp::{btw_prompt, cleanse_args, tan_prompt, tan_title};
use super::session::{count, current_entry, session_sections, tree_line};
use super::*;

#[test]
fn tree_marks_the_current_message_and_indents_branches() {
    let entry = |id: &str, parent: Option<&str>, role: &str, text: &str| {
        json!({"type": "message", "id": id, "parentId": parent,
               "message": {"role": role, "content": [{"type": "text", "text": text}]}})
    };
    let roots = [json!({
        "entry": entry("a", None, "user", "first"),
        "children": [
            {"entry": entry("b", Some("a"), "assistant", "reply one"), "children": [
                {"entry": {"type": "model_change", "id": "m", "parentId": "b"}, "children": []}
            ]},
            {"entry": entry("c", Some("a"), "assistant", "reply two"), "children": []},
        ],
    })];
    let refs: Vec<&Value> = roots.iter().collect();
    assert_eq!(current_entry(&refs, Some("m")), Some("b"));
    assert_eq!(tree_line(&roots[0]["entry"]).as_deref(), Some("You: first"));
}

#[test]
fn side_prompts_match_omp() {
    let btw = btw_prompt("  why this file?  ");
    assert!(btw.starts_with("<btw>\nEphemeral side question"));
    assert!(btw.ends_with("Question:\nwhy this file?\n</btw>"));
    assert!(btw.contains("NEVER use tools."));

    let tan = tan_prompt(" fix the docs ");
    assert!(tan.starts_with("<system-notice cause=\"fork\">"));
    assert!(tan.ends_with("</system-notice>\n\nfix the docs"));
    assert_eq!(tan_title("fix\n  the   docs"), "fix the docs");
    assert_eq!(tan_title(&"a".repeat(100)).chars().count(), 80);

    let first = omfg_prompt("stop using any", &[], None);
    assert!(first.starts_with("<omfg>\n"));
    assert!(first.ends_with("Complaint:\nstop using any\n</omfg>"));
    assert!(!first.contains("Failed attempts"));
    let retry = omfg_prompt("stop", &["Attempt 1 failed".into()], Some("{}"));
    assert!(retry.contains("Failed attempts or requested amendments so far:\nAttempt 1 failed"));
    assert!(retry.contains("Latest candidate JSON:\n{}"));
    assert_eq!(omfg_args("--global stop  this"), (true, "stop this".into()));
    assert_eq!(omfg_args("stop"), (false, "stop".into()));
}

#[test]
fn forged_rules_are_assembled_like_omp() {
    let reply = r#"Here: ```json
{"name": "TS No 'Any'!", "description": "Never use any", "condition": ": any|as any",
 "scope": ["tool:edit(*.ts)", "tool:write(*.ts)", "tool:edit(*.ts)"], "body": "Use unknown.\r\nOr a generic."}
```"#;
    let rule = parse_rule(reply).unwrap();
    assert_eq!(rule.name, "ts-no-any");
    assert_eq!(
        rule.file,
        "---\nname: ts-no-any\ndescription: \"Never use any\"\ncondition: \": any|as any\"\n\
         scope: [\"tool:edit(*.ts)\", \"tool:write(*.ts)\"]\n---\n\nUse unknown.\nOr a generic."
    );
    assert!(parse_rule("no json here").is_err());
    assert!(parse_rule(
        r#"{"name": "x", "description": "d", "condition": [], "scope": "text", "body": "b"}"#
    )
    .is_err());
    assert_eq!(
        balanced_object(r#"x {"a": "}{", "b": {}} y"#),
        Some(r#"{"a": "}{", "b": {}}"#)
    );
    assert_eq!(rule_name("--Hello  World__"), "hello-world");
}

#[test]
fn cleanse_arguments_become_omps_flags() {
    assert_eq!(cleanse_args("").unwrap(), vec!["cleanse"]);
    assert_eq!(
        cleanse_args("ts errors -a -n 8 --model opus -t").unwrap(),
        vec![
            "cleanse",
            "ts errors",
            "--all",
            "--agents",
            "8",
            "--model",
            "opus",
            "--tests"
        ]
    );
    assert!(cleanse_args("-n 0").is_err());
    assert!(cleanse_args("--bogus").is_err());
    assert!(cleanse_args("-m").is_err());
}

#[test]
fn tui_only_modes_say_why() {
    assert!(matches!(
        omp_tui_only("vibe"),
        Some(Output::Done { notice: Some(_) })
    ));
    assert!(omp_tui_only("goal").is_none());
    assert!(omp_tui_only("btw").is_none());
    assert!(omp_usage("btw", "").is_some());
    assert!(omp_usage("omfg", "--global").is_some());
    assert!(omp_usage("tan", "work").is_none());
}

/// get_state and get_session_stats as pi 1.5.2 answers them in rpc mode.
#[test]
fn session_panel_reads_pi_1_5_state_and_stats() {
    let state = json!({"model":{"id":"probe-model","name":"probe-model","api":"openai-completions",
        "provider":"probe","contextWindow":128000},"thinkingLevel":"off","isStreaming":false,
        "sessionFile":"/s/2026-11-14T04-41-59-768Z_01a1d85c.jsonl","sessionId":"01a1d85c",
        "sessionName":"Probe name","autoCompactionEnabled":true,"messageCount":2});
    let stats = json!({"sessionFile":"/s/x.jsonl","sessionId":"01a1d85c","userMessages":1,
        "assistantMessages":3,"toolCalls":0,"toolResults":0,"totalMessages":5,
        "tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0},"cost":0,
        "contextUsage":{"tokens":1645,"contextWindow":128000,"percent":1.28515625}});
    let sections = session_sections(&state, &stats);
    let rows = |index: usize| -> Vec<(String, String)> {
        sections[index]
            .rows
            .iter()
            .map(|row| (row.label.clone(), row.value.clone()))
            .collect()
    };
    assert_eq!(
        rows(0),
        [
            ("Name", "Probe name"),
            ("Session", "01a1d85c"),
            ("File", "/s/2026-11-14T04-41-59-768Z_01a1d85c.jsonl"),
            ("Model", "probe/probe-model"),
            ("Thinking", "off"),
            ("Auto-compaction", "On"),
        ]
        .map(|(label, value)| (label.to_string(), value.to_string()))
    );
    assert!(rows(1).contains(&("Total".into(), "5".into())));
    assert!(rows(2).contains(&("Context".into(), "1,645 of 128,000 (1.3%)".into())));
    // No model to run: pi says "unknown", and an empty session has no context usage.
    let state = json!({"model":{"id":"unknown","name":"unknown","provider":"unknown"},
        "thinkingLevel":"off","sessionId":"01a1d85b","autoCompactionEnabled":true});
    let stats = json!({"userMessages":0,"totalMessages":0,"tokens":{"total":0},"cost":0});
    let sections = session_sections(&state, &stats);
    assert!(!sections[0].rows.iter().any(|row| row.label == "Model"));
    assert!(!sections[2].rows.iter().any(|row| row.label == "Context"));
}

/// pi 1.5.2's get_tree after a prompt that never reached a model: its system prompt, the
/// person's message, three failed replies and the retries' context edits.
#[test]
fn tree_of_a_pi_1_5_session_marks_the_last_shown_message() {
    let node = |entry: Value, children: Vec<Value>| json!({"entry": entry, "children": children});
    let message = |id: &str, parent: &str, role: &str, text: &str| {
        json!({"type":"message","id":id,"parentId":parent,
               "message":{"role":role,"content":[{"type":"text","text":text}]}})
    };
    let mut chain = node(
        json!({"type":"context_edit","id":"15fd349c","parentId":"2459a555"}),
        vec![],
    );
    for (id, parent, role, text) in [
        ("2459a555", "dfe2f1c2", "assistant", ""),
        ("dfe2f1c2", "330aa465", "", ""),
        ("330aa465", "621bc57a", "assistant", ""),
        ("621bc57a", "bbb595cc", "", ""),
        ("bbb595cc", "8daeed15", "assistant", ""),
        ("8daeed15", "08a44657", "user", "hello probe"),
        ("08a44657", "6735ec17", "system", ""),
    ] {
        let entry = if role.is_empty() {
            json!({"type":"context_edit","id":id,"parentId":parent,"targetId":parent})
        } else {
            message(id, parent, role, text)
        };
        chain = node(entry, vec![chain]);
    }
    let roots = [node(
        json!({"type":"model_change","id":"2c5a77a2","parentId":null,"provider":"probe"}),
        vec![node(
            json!({"type":"thinking_level_change","id":"6735ec17","parentId":"2c5a77a2"}),
            vec![chain],
        )],
    )];
    let refs: Vec<&Value> = roots.iter().collect();
    assert_eq!(current_entry(&refs, Some("15fd349c")), Some("8daeed15"));
}

#[test]
fn counts_have_separators() {
    assert_eq!(count(0.0), "0");
    assert_eq!(count(1234.0), "1,234");
    assert_eq!(count(1234567.0), "1,234,567");
}
