//! The Qoder CLI commands Misty lists and runs (see `slash/mod.rs`).
//!
//! Misty runs Qoder over ACP (`qoder_session.rs`). Its ACP mode reports only `/rewind`,
//! `/rename` and `/goal`, but it runs every slash command whose action doesn't open a dialog:
//! the turns here are ones checked in qodercli 1.1.89's bundle to answer without one
//! (`/compact` its session compacts natively). The terminal app's dialogs (`/agents`, `/hooks`,
//! `/permissions`, `/memory`) are answered from Qoder's files, and `/branch` through its ACP
//! `session/fork`. `/init` opens a choice dialog whenever the session is interactive, as ACP
//! sessions are, and so never returns there; Misty sends the prompt its Quick choice (and its
//! non-interactive run) submits instead.

use std::path::{Path, PathBuf};

use super::files;
use super::{misty, turn, Command, Context, Output};
use crate::engines::qoder::QoderDistribution;

pub const COMMANDS: &[Command] = &[
    turn(
        "compact",
        "Compresses the context by replacing it with a summary",
    )
    .hint("[instructions]"),
    turn(
        "subtask",
        "Send a subagent off with your full context; its result comes back here",
    )
    .hint("<directive>"),
    turn(
        "statusline",
        "Set up a custom status line. Uses a sub-agent to read your shell config and create a statusline script that's updated after each response.",
    )
    .hint("[request]"),
    misty("review", "Review code changes and find actionable issues").hint("[instructions]"),
    misty(
        "branch",
        "Create a new session branch from the current conversation",
    )
    .hint("[name]"),
    misty(
        "fork",
        "Create a new session branch from the current conversation",
    )
    .hint("[name]"),
    misty("agents", "Manage agents"),
    misty("hooks", "Open hooks management panel"),
    misty("permissions", "Manage permissions"),
    misty("memory", "Show the AGENTS.md files in use"),
    misty(
        "init",
        "Analyzes the project and creates a tailored context file",
    ),
];

/// What `/review` reviews when it's given nothing: bare, Qoder's command opens a picker that
/// its ACP mode can't show, which would hold the turn open.
const DEFAULT_REVIEW: &str =
    "Review the current changes (staged, unstaged and untracked) and find actionable issues.";

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let distribution = if context.engine == "qoder-cn" {
        QoderDistribution::Cn
    } else {
        QoderDistribution::Global
    };
    let home = config_dir(distribution).ok_or("No home folder to read Qoder's files from.")?;
    let folder = context.folder.as_deref();
    // The project's own folder is named like the user one (`.qoder`).
    let project = distribution.default_config_dir_name();
    match name {
        "review" => Ok(Output::send(format!(
            "/review {}",
            if context.args.is_empty() {
                DEFAULT_REVIEW
            } else {
                context.args.as_str()
            }
        ))),
        "branch" | "fork" => fork(&context).await,
        "agents" => {
            let mut dirs = vec![("User", home.join("agents"))];
            if let Some(folder) = folder {
                dirs.push(("Project", folder.join(project).join("agents")));
            }
            Ok(files::agents_info("Qoder", &dirs))
        }
        "hooks" => Ok(files::hooks_info(
            "Qoder",
            &files::settings_files(&home, project, folder, true),
        )),
        "permissions" => Ok(files::permissions_info(
            "Qoder",
            &files::settings_files(&home, project, folder, true),
        )),
        "memory" => Ok(memory(&home, folder)),
        "init" => Ok(Output::send(init_prompt(&context_file_name(
            &files::settings_files(&home, project, folder, true),
        )))),
        _ => Err(format!("Misty doesn't run /{name} for Qoder.")),
    }
}

/// `~/.qoder` (or `~/.qoder-cn`).
fn config_dir(distribution: QoderDistribution) -> Option<PathBuf> {
    files::home().map(|home| home.join(distribution.default_config_dir_name()))
}

/// The context files Qoder loads: `AGENTS.md` in its own folder, and `AGENTS.override.md`,
/// `AGENTS.md` and `AGENTS.local.md` in the project's folders.
fn memory(home: &Path, folder: Option<&Path>) -> Output {
    Output::info(
        "Qoder memory",
        vec![files::context_section(
            "Context files",
            &[home.join("AGENTS.md")],
            &["AGENTS.override.md", "AGENTS.md", "AGENTS.local.md"],
            folder,
        )],
    )
}

/// The prompt qodercli 1.1.89's `/init` submits in its Quick mode, which is also what it runs
/// when the session isn't interactive (`Xgt({mode: "quick"})` in its bundle), with `{name}` for
/// the context file's name.
const INIT_PROMPT: &str = r#"Analyze the codebase and write a minimal {name}. {name} is loaded into every session, so it must be concise — only include what the AI would get wrong without it.

## Step 1: Explore the codebase

1. List files and directories for a high-level overview of the structure.
2. Read the README file if it exists.
3. Iteratively read up to 10 important files (configuration files, main source files, build configs, CI config, existing AI tool configs like .cursor/rules, .cursorrules, .github/copilot-instructions.md).

## Step 2: Write {name}

Write a minimal {name} at the project root. Every line must pass this test: "Would removing this cause the AI to make mistakes?" If no, cut it.

Include:
- Build/test/lint commands the AI can't guess (non-standard scripts, flags, or sequences)
- Code style rules that DIFFER from language defaults
- Testing instructions and quirks
- Repo etiquette (branch naming, PR conventions, commit style)
- Required env vars or setup steps
- Non-obvious gotchas or architectural decisions
- Important parts from existing AI coding tool configs if they exist

Exclude:
- File-by-file structure or component lists
- Standard language conventions the AI already knows
- Generic advice ("write clean code", "handle errors")
- Commands obvious from manifest files (e.g., standard "npm test", "cargo test", "pytest")

Prefix the file with:

```
# {name}

This file provides guidance to the AI agent when working with code in this repository.
```

If {name} already exists: read it, propose specific changes as diffs, and explain why each change improves it. Do not silently overwrite.

## Step 3: Summary

Summarize what was written. Remind the user they can run `/init` again and choose "Interactive" mode for skills and hooks setup."#;

fn init_prompt(name: &str) -> String {
    INIT_PROMPT.replace("{name}", name)
}

/// The context file `/init` writes: the first of the settings' `context.fileName` (a name or a
/// list of them; the project's settings over the user's), else `AGENTS.md`, as Qoder reads it.
fn context_file_name(settings: &[(&str, PathBuf)]) -> String {
    settings
        .iter()
        .rev()
        .filter_map(|(_, path)| files::read_json(path))
        .find_map(|settings| {
            let name = settings.pointer("/context/fileName")?;
            let first = match name {
                serde_json::Value::Array(names) => names.first()?,
                name => name,
            };
            first
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "AGENTS.md".to_string())
}

/// `/branch [name]` (and `/fork`): qodercli copies the session over ACP (`session/fork`), with
/// no model call, and the copy opens as a new chat under the given name.
async fn fork(context: &Context) -> Result<Output, String> {
    let session = context
        .session
        .as_deref()
        .ok_or("Qoder has no session for this chat yet. Send a message first.")?;
    let folder = context
        .folder
        .as_deref()
        .ok_or("This chat has no folder for Qoder's session.")?;
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, &context.engine);
    let env = crate::engine_config::engine_env::env_for(&context.engine).unwrap_or_default();
    let forked = crate::engines::qoder_session::fork_session(&bin, folder, session, &env).await?;
    Ok(Output::Fork {
        session: forked,
        title: (!context.args.is_empty()).then(|| context.args.clone()),
        prompt: None,
    })
}

/// Runs Misty's out-of-turn Qoder commands against the installed qodercli and the person's real
/// `~/.qoder` (read only), with a scratch project holding agents, hooks, rules and context
/// files, and prints each Output to read. None makes a model call: they read files, and
/// `/branch` asks qodercli's ACP `session/fork`, which needs Qoder's sign-in.
/// `cargo test --lib engines::slash::qoder::live_tests -- --ignored --nocapture --test-threads 1`
#[cfg(all(test, unix))]
mod live_tests {
    #![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.
    use std::path::Path;

    use super::super::{run, Context, Output};

    /// The test binary points HOME at a scratch folder (`isolate_for_tests`); Qoder's files live
    /// in the person's real one, which their account record names.
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

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn context(
        folder: &Path,
        db: &database::store::Store,
        session: Option<&str>,
        args: &str,
    ) -> Context {
        Context {
            engine: "qoder".into(),
            account: "live-test".into(),
            conversation: "live-test".into(),
            folder: Some(folder.to_path_buf()),
            session: session.map(str::to_string),
            args: args.into(),
            db: db.clone(),
        }
    }

    async fn show(context: Context, name: &str) -> Result<Output, String> {
        let label = format!("/{name} {}", context.args);
        let outcome = run(context, name).await;
        let shown = match &outcome {
            Ok(output) => serde_json::to_string_pretty(output).unwrap(),
            Err(error) => format!("ERROR: {error}"),
        };
        println!("\n===== qoder {label}\n{shown}");
        outcome
    }

    #[tokio::test]
    #[ignore = "runs the installed Qoder CLI"]
    async fn qoder_commands() {
        use_real_home();
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().canonicalize().unwrap().join("project");
        let db = database::store::Store::at(dir.path().join("misty.db"));
        std::fs::create_dir_all(folder.join(".git")).unwrap();
        write(
            &folder.join(".qoder/agents/reviewer.md"),
            "---\nname: reviewer\ndescription: Reviews the diff\n---\nYou review.\n",
        );
        write(
            &folder.join(".qoder/settings.json"),
            r#"{
  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo pre" }] }] },
  "permissions": { "allow": ["Bash(git status)"], "defaultMode": "accept_edits" },
  "context": { "fileName": ["QODER.md", "AGENTS.md"] }
}"#,
        );
        write(
            &folder.join(".qoder/settings.local.json"),
            r#"{ "permissions": { "deny": ["Read(.env)"] } }"#,
        );
        write(&folder.join("AGENTS.md"), "# Project\n");
        write(&folder.join("AGENTS.local.md"), "# Mine\nonly\n");

        let mut failed = Vec::new();
        for name in ["agents", "hooks", "permissions", "memory"] {
            if show(context(&folder, &db, None, ""), name).await.is_err() {
                failed.push(name);
            }
        }
        assert!(failed.is_empty(), "failed: {failed:?}");
        let text = |output: Output| serde_json::to_string(&output).unwrap();
        let agents = text(
            show(context(&folder, &db, None, ""), "agents")
                .await
                .unwrap(),
        );
        assert!(agents.contains("Reviews the diff"), "{agents}");
        let hooks = text(
            show(context(&folder, &db, None, ""), "hooks")
                .await
                .unwrap(),
        );
        assert!(
            hooks.contains("PreToolUse · Bash") && hooks.contains("echo pre"),
            "{hooks}"
        );
        let rules = text(
            show(context(&folder, &db, None, ""), "permissions")
                .await
                .unwrap(),
        );
        assert!(
            rules.contains("Read(.env)") && rules.contains("accept_edits"),
            "{rules}"
        );
        let memory = text(
            show(context(&folder, &db, None, ""), "memory")
                .await
                .unwrap(),
        );
        assert!(
            memory.contains("AGENTS.local.md") && memory.contains("2 lines"),
            "{memory}"
        );

        // `/init` sends the Quick prompt for the context file the settings name first.
        match show(context(&folder, &db, None, ""), "init").await {
            Ok(Output::Send { text }) => {
                assert!(text.starts_with("Analyze the codebase and write a minimal QODER.md."));
                assert!(!text.contains("{name}"));
            }
            other => panic!("init: {other:?}"),
        }
        match show(context(&folder, &db, None, ""), "review").await {
            Ok(Output::Send { text }) => assert!(text.starts_with("/review Review the current")),
            other => panic!("review: {other:?}"),
        }
        assert!(show(context(&folder, &db, None, ""), "branch")
            .await
            .is_err());
        // A real `session/fork`: without Qoder's sign-in it fails with qodercli's own words.
        let fork = show(
            context(
                &folder,
                &db,
                Some("00000000-0000-0000-0000-000000000000"),
                "copy",
            ),
            "branch",
        )
        .await;
        println!("fork: {fork:?}");
        assert!(fork.is_err());
    }
}
