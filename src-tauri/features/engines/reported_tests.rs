use super::*;
use serde_json::json;

#[test]
fn claude_init_keeps_commands_apart_from_skills() {
    claude_init(
        "test-claude",
        &json!({
            "slash_commands": ["compact", "context", "review", "pdf", "bad name", ""],
            "skills": ["pdf"],
        }),
    );
    let report = report_of("test-claude");
    let commands: Vec<_> = report
        .commands
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(commands, ["compact", "context", "review"]);
    assert_eq!(report.skills.unwrap()[0].name, "pdf");
    forget("test-claude");
}

#[test]
fn acp_commands_carry_their_description_and_hint() {
    acp_update(
        "test-acp",
        &json!({"update": {
            "sessionUpdate": "available_commands_update",
            "availableCommands": [
                {"name": "init", "description": "Analyze the project\nand write a file"},
                {"name": "/memory", "description": "Manage memory", "input": {"hint": "show | add"}},
            ],
            "_meta": {"availableSkills": ["review-pr"]},
        }}),
    );
    let report = report_of("test-acp");
    let commands = report.commands.unwrap();
    assert_eq!(
        commands[0].description,
        "Analyze the project and write a file"
    );
    assert_eq!(commands[1].name, "memory");
    assert_eq!(commands[1].argument_hint.as_deref(), Some("show | add"));
    assert_eq!(report.skills.unwrap()[0].name, "review-pr");
    acp_update(
        "test-acp",
        &json!({"update": {"sessionUpdate": "agent_message_chunk"}}),
    );
    assert_eq!(report_of("test-acp").commands.unwrap().len(), 2);
    forget("test-acp");
}

const SPACED_SUBCOMMANDS: &str = r###"{
 "sessionId": "92522f73-f827-47bf-84ef-e97a910dd17f",
 "update": {
  "sessionUpdate": "available_commands_update",
  "availableCommands": [
   {
    "name": "memory",
    "description": "Manage memory."
   },
   {
    "name": "memory show",
    "description": "Shows the current memory contents."
   },
   {
    "name": "memory refresh",
    "description": "Refreshes the memory from the source."
   },
   {
    "name": "memory list",
    "description": "Lists the paths of the AGENTS.md files in use."
   },
   {
    "name": "memory inbox",
    "description": "Lists memory items extracted from past sessions that are pending review."
   },
   {
    "name": "extensions",
    "description": "Manage extensions."
   },
   {
    "name": "extensions list",
    "description": "Lists all installed extensions."
   },
   {
    "name": "extensions explore",
    "description": "Explore available extensions."
   },
   {
    "name": "extensions enable",
    "description": "Enable an extension."
   },
   {
    "name": "extensions disable",
    "description": "Disable an extension."
   },
   {
    "name": "extensions install",
    "description": "Install an extension from a git repo or local path."
   },
   {
    "name": "extensions link",
    "description": "Link an extension from a local path."
   },
   {
    "name": "extensions uninstall",
    "description": "Uninstall an extension."
   },
   {
    "name": "extensions restart",
    "description": "Restart an extension."
   },
   {
    "name": "extensions update",
    "description": "Update an extension."
   },
   {
    "name": "init",
    "description": "Analyzes the project and creates a tailored AGENTS.md file"
   },
   {
    "name": "restore",
    "description": "Restore to a previous checkpoint, or list available checkpoints to restore. This will reset the conversation and file history to the state it was in when the checkpoint was created"
   },
   {
    "name": "restore list",
    "description": "Lists all available checkpoints."
   },
   {
    "name": "about",
    "description": "Show version and environment info"
   },
   {
    "name": "help",
    "description": "Show available commands"
   }
  ]
 }
}"###;

#[test]
fn spaced_subcommands_fold_into_their_commands_hint() {
    acp_update(
        "test-subcommands",
        &serde_json::from_str(SPACED_SUBCOMMANDS).unwrap(),
    );
    let commands = report_of("test-subcommands").commands.unwrap();
    let names: Vec<&str> = commands.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        names,
        ["memory", "extensions", "init", "restore", "about", "help"]
    );
    let hint = |name: &str| {
        commands
            .iter()
            .find(|c| c.name == name)
            .and_then(|c| c.argument_hint.clone())
    };
    assert_eq!(
        hint("memory").as_deref(),
        Some("show | refresh | list | inbox")
    );
    assert_eq!(
        hint("extensions").as_deref(),
        Some("list | explore | enable | disable | install | link | uninstall | restart | update")
    );
    assert_eq!(hint("restore").as_deref(), Some("list"));
    assert_eq!(hint("init"), None);
    assert_eq!(commands[0].description, "Manage memory.");
    forget("test-subcommands");
}

#[test]
fn a_long_list_of_choices_keeps_whole_choices() {
    let subcommands: Vec<String> = (0..40).map(|n| format!("choice{n}")).collect();
    acp_update(
        "test-long",
        &json!({"update": {
            "sessionUpdate": "available_commands_update",
            "availableCommands": [
                {"name": "many", "_meta": {"subcommands": subcommands}},
                {"name": "two", "description": "Two"},
            ],
        }}),
    );
    let commands = report_of("test-long").commands.unwrap();
    let hint = commands[0].argument_hint.clone().unwrap();
    assert!(hint.chars().count() <= MOST_CHOICES, "{hint}");
    assert!(hint
        .split(" | ")
        .all(|choice| subcommands.contains(&choice.to_string())));
    forget("test-long");
}
