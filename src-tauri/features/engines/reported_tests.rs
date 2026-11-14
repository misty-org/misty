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
    // Other updates change nothing.
    acp_update(
        "test-acp",
        &json!({"update": {"sessionUpdate": "agent_message_chunk"}}),
    );
    assert_eq!(report_of("test-acp").commands.unwrap().len(), 2);
    forget("test-acp");
}

/// What Gemini CLI 0.68 sent once `session/new` opened a session (captured from the real
/// install): its subcommands as two-word entries, folded into their command's hint whole.
const GEMINI_0_68_COMMANDS: &str = r###"{
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
    "description": "Lists the paths of the GEMINI.md files in use."
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
    "description": "Analyzes the project and creates a tailored GEMINI.md file"
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

/// Part of what Qwen Code 0.27.3 sent (captured from the real install): hints in
/// `input.hint` or `_meta.subcommands`, a project `.toml` command, and skills named alone.
const QWEN_0_27_COMMANDS: &str = r###"{
 "sessionId": "a580addf-cdf0-44e2-9e2b-bce528ea369f",
 "update": {
  "sessionUpdate": "available_commands_update",
  "availableCommands": [
   {
    "name": "status",
    "description": "show version info",
    "input": {
     "hint": ""
    },
    "_meta": {
     "source": "builtin-command",
     "sourceLabel": "Built-in",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [
      "paths"
     ],
     "modelInvocable": false,
     "altNames": [
      "about"
     ]
    }
   },
   {
    "name": "advisor",
    "description": "Configure the Advisor model",
    "input": {
     "hint": "[<model-id>|off|review [focus]]"
    },
    "_meta": {
     "argumentHint": "[<model-id>|off|review [focus]]",
     "source": "builtin-command",
     "sourceLabel": "Built-in",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [],
     "modelInvocable": false
    }
   },
   {
    "name": "context",
    "description": "Show context window usage breakdown. Use \"/context detail\" for per-item breakdown.",
    "input": {
     "hint": ""
    },
    "_meta": {
     "source": "builtin-command",
     "sourceLabel": "Built-in",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [
      "detail"
     ],
     "modelInvocable": false
    }
   },
   {
    "name": "doctor",
    "description": "Run installation and environment diagnostics",
    "input": {
     "hint": "[memory|cpu-profile|rollback] [--sample] [--snapshot] [--duration]"
    },
    "_meta": {
     "argumentHint": "[memory|cpu-profile|rollback] [--sample] [--snapshot] [--duration]",
     "source": "builtin-command",
     "sourceLabel": "Built-in",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [
      "memory",
      "cpu-profile",
      "rollback"
     ],
     "modelInvocable": false
    }
   },
   {
    "name": "extensions",
    "description": "Manage extensions",
    "input": {
     "hint": ""
    },
    "_meta": {
     "source": "builtin-command",
     "sourceLabel": "Built-in",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [
      "list",
      "manage",
      "install",
      "explore"
     ],
     "modelInvocable": false
    }
   },
   {
    "name": "loop",
    "description": "Create a loop that runs a prompt now and follows up either on a fixed schedule or through self-paced wakeups. Usage - /loop check the build, /loop 5m check the build, /loop check the PR every 30m. /loop list to show jobs, /loop clear to cancel all.",
    "input": {
     "hint": "[interval] [prompt] | list | clear"
    },
    "_meta": {
     "argumentHint": "[interval] [prompt] | list | clear",
     "source": "bundled-skill",
     "sourceLabel": "Skill",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [],
     "modelInvocable": true
    }
   },
   {
    "name": "review",
    "description": "Review changed code for correctness, security, code quality, and performance. Use when the user asks to review code changes, a PR, or specific files. Invoke with `/review`, `/review <pr-number>`, `/review <file-path>`, `/review <pr-number> --comment` to post inline comments on the PR, `/review --fix` to apply the findings to your working tree, or `/review <pr-number> --resume` to continue an interrupted review of that PR at an unmoved head (a re-review after new commits is a plain `/review <pr-number>`). Add `--effort low|medium|high` to trade depth for speed (defaults to high for PRs, medium for local changes). Add `--topology minimal` to run the single-pass A/B comparison arm instead of the pipeline.",
    "input": {
     "hint": "[pr-number|file-path] [--effort low|medium|high] [--severity-floor critical|suggestion] [--topology minimal] [--comment] [--fix] [--resume]"
    },
    "_meta": {
     "argumentHint": "[pr-number|file-path] [--effort low|medium|high] [--severity-floor critical|suggestion] [--topology minimal] [--comment] [--fix] [--resume]",
     "source": "bundled-skill",
     "sourceLabel": "Skill",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [],
     "modelInvocable": true
    }
   },
   {
    "name": "qfoo",
    "description": "Qwen foo",
    "input": {
     "hint": ""
    },
    "_meta": {
     "source": "skill-dir-command",
     "sourceLabel": "Custom",
     "supportedModes": [
      "interactive",
      "non_interactive",
      "acp"
     ],
     "subcommands": [],
     "modelInvocable": true
    }
   }
  ],
  "_meta": {
   "availableSkills": [
    "loop",
    "review"
   ],
   "availableSkillDetails": [
    {
     "name": "loop",
     "description": "Create a loop that runs a prompt now and follows up either on a fixed schedule or through self-paced wakeups. Usage - /loop check the build, /loop 5m check the build, /loop check the PR every 30m. /loop list to show jobs, /loop clear to cancel all."
    }
   ]
  }
 }
}"###;

#[test]
fn gemini_subcommands_fold_into_their_commands_hint() {
    acp_update(
        "test-gemini",
        &serde_json::from_str(GEMINI_0_68_COMMANDS).unwrap(),
    );
    let commands = report_of("test-gemini").commands.unwrap();
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
    forget("test-gemini");
}

#[test]
fn qwen_hints_and_skill_descriptions_come_from_its_report() {
    acp_update(
        "test-qwen",
        &serde_json::from_str(QWEN_0_27_COMMANDS).unwrap(),
    );
    let report = report_of("test-qwen");
    let commands = report.commands.unwrap();
    let hint = |name: &str| {
        commands
            .iter()
            .find(|c| c.name == name)
            .and_then(|c| c.argument_hint.clone())
    };
    assert_eq!(hint("status").as_deref(), Some("paths"));
    assert_eq!(
        hint("extensions").as_deref(),
        Some("list | manage | install | explore")
    );
    assert_eq!(
        hint("advisor").as_deref(),
        Some("[<model-id>|off|review [focus]]")
    );
    assert!(commands
        .iter()
        .any(|c| c.name == "qfoo" && c.description == "Qwen foo"));
    let skills = report.skills.unwrap();
    assert_eq!(skills.len(), 2);
    // `loop` from `availableSkillDetails`, `review` from its command.
    assert!(
        skills.iter().all(|s| !s.description.is_empty()),
        "{skills:?}"
    );
    forget("test-qwen");
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
