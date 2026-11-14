//! The CodeBuddy Code commands Misty lists and runs (see `slash/mod.rs`).
//!
//! Misty runs CodeBuddy headless (`-p --input-format stream-json`), whose `system/init` message
//! lists every command once a chat has run. The turns here are its prompt and agent commands
//! (from codebuddy-headless.js's built-in list), so the `/` menu has them before that. Its
//! terminal-only panels are answered from `~/.codebuddy` and the project's files, and its page
//! commands open the page.
//!
//! Left out: `/doctor` (the `codebuddy doctor` subcommand renders the terminal app's panel and
//! never finishes without a terminal; headless, the command does nothing) and
//! `/install-github-app` (its setup isn't in the installed CLI's code to follow).

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::files;
use super::{misty, turn, Command, Context, Output};

pub const COMMANDS: &[Command] = &[
    turn("init", "Create a CODEBUDDY.md file with instructions for this codebase"),
    turn("compact", "Summarize the conversation so far to free context").hint("[instructions]"),
    turn("review", "Review a pull request"),
    turn("pr-comments", "Get comments from a GitHub pull request"),
    turn(
        "simplify",
        "Clean up the changed code without changing behavior \u{2014} reuse, simplification, efficiency, and altitude cleanups",
    )
    .hint("[target]"),
    turn(
        "code-review",
        "Review the current diff for correctness bugs and quality cleanups. Pass --fix to apply findings, --comment to post as PR comments",
    )
    .hint("[--fix] [--comment] [target]"),
    turn(
        "verify",
        "Verify code changes work as expected by running the app and tests",
    )
    .hint("[description]"),
    turn(
        "deep-research",
        "Run a multi-angle web research workflow on a question and produce a cited report",
    )
    .hint("<question>"),
    turn(
        "goal",
        "Keep working until a condition is met. Use \"/goal clear\" to stop early. Example: /goal all tests pass",
    )
    .hint("<condition> | clear"),
    misty(
        "agents",
        "Manage agent configurations (create/edit custom agents and builtin subagent models)",
    ),
    misty("hooks", "Manage hook configurations for tool events"),
    misty("memory", "Show the CODEBUDDY.md files in use"),
    misty("permissions", "Manage allow & deny tool permission rules"),
    misty(
        "feedback",
        "Open the issue feedback page to report bugs or suggest features",
    ),
    misty("upgrade", "Open the upgrade page in your browser"),
];

/// The pages from the CLI's `product.json` (`links`), used when the installed one can't be
/// read.
const ISSUE_URL: &str = "https://cnb.cool/codebuddy/codebuddy-code/-/issues/new";
const UPGRADE_URL: &str = "https://www.codebuddy.ai/profile/plan";

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let home = files::home()
        .map(|home| home.join(".codebuddy"))
        .ok_or("No home folder to read CodeBuddy's files from.")?;
    let folder = context.folder.as_deref();
    match name {
        "agents" => {
            let mut dirs = vec![("User", home.join("agents"))];
            if let Some(folder) = folder {
                dirs.push(("Project", folder.join(".codebuddy").join("agents")));
            }
            Ok(files::agents_info("CodeBuddy", &dirs))
        }
        "hooks" => Ok(files::hooks_info(
            "CodeBuddy",
            &files::settings_files(&home, ".codebuddy", folder, true),
        )),
        "permissions" => Ok(files::permissions_info(
            "CodeBuddy",
            &files::settings_files(&home, ".codebuddy", folder, true),
        )),
        "memory" => Ok(memory(&home, folder)),
        "feedback" => feedback(),
        "upgrade" => Ok(Output::open(format!(
            "url:{}",
            product_link("upgradeUrl").unwrap_or_else(|| UPGRADE_URL.to_string())
        ))),
        _ => Err(format!("Misty doesn't run /{name} for CodeBuddy.")),
    }
}

/// The memory files CodeBuddy loads: `CODEBUDDY.md` (or `.mdc`) in `~/.codebuddy`, and in the
/// project's folders `CODEBUDDY.md`, `CODEBUDDY.local.md` (each also as `.mdc`),
/// `.codebuddy/CODEBUDDY.md` and the `AGENTS.md` it falls back to.
fn memory(home: &Path, folder: Option<&Path>) -> Output {
    Output::info(
        "CodeBuddy memory",
        vec![files::context_section(
            "Memory files",
            &[home.join("CODEBUDDY.md"), home.join("CODEBUDDY.mdc")],
            &[
                "CODEBUDDY.md",
                "CODEBUDDY.mdc",
                "CODEBUDDY.local.md",
                "CODEBUDDY.local.mdc",
                ".codebuddy/CODEBUDDY.md",
                "AGENTS.md",
            ],
            folder,
        )],
    )
}

/// `/feedback`: CodeBuddy's new-issue page, its body started with the system it runs on (the
/// CLI also adds the account id, which Misty leaves out).
fn feedback() -> Result<Output, String> {
    let page = product_link("issueCreation").unwrap_or_else(|| ISSUE_URL.to_string());
    let mut url = url::Url::parse(&page).map_err(|error| format!("Bad feedback page: {error}"))?;
    let body = format!(
        "**Platform:** {} {}\n\n**Description:**\n",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    url.query_pairs_mut().append_pair("body", &body);
    Ok(Output::open(format!("url:{url}")))
}

/// One of the `links` in the installed CLI's `product.json`.
fn product_link(key: &str) -> Option<String> {
    let product = files::read_json(&package_dir()?.join("product.json"))?;
    product
        .pointer(&format!("/links/{key}"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// The installed CodeBuddy package: the folder with `product.json` above the program.
fn package_dir() -> Option<PathBuf> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "codebuddy");
    let program = if Path::new(&bin).is_absolute() {
        PathBuf::from(&bin)
    } else {
        crate::engines::resolve::find_program(&bin)?
    };
    let program = std::fs::canonicalize(program).ok()?;
    program
        .ancestors()
        .find(|dir| dir.join("product.json").is_file())
        .map(Path::to_path_buf)
}

/// Runs Misty's out-of-turn CodeBuddy commands against the installed CLI's package and the
/// person's real `~/.codebuddy` (read only), with a scratch project, and prints each Output to
/// read. None makes a model call or changes anything.
/// `cargo test --lib engines::slash::codebuddy::live_tests -- --ignored --nocapture --test-threads 1`
#[cfg(all(test, unix))]
mod live_tests {
    #![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.
    use std::path::Path;

    use super::super::{run, Context, Output};

    /// The test binary points HOME at a scratch folder (`isolate_for_tests`); CodeBuddy's files
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

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[tokio::test]
    #[ignore = "reads the installed CodeBuddy CLI"]
    async fn codebuddy_commands() {
        use_real_home();
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().canonicalize().unwrap().join("project");
        let db = database::store::Store::at(dir.path().join("misty.db"));
        write(
            &folder.join(".codebuddy/agents/team/reviewer.md"),
            "---\nname: reviewer\ndescription: Reviews the diff\n---\nYou review.\n",
        );
        write(
            &folder.join(".codebuddy/settings.json"),
            r#"{
  "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "echo stop" }] }] },
  "permissions": { "deny": ["Bash(curl:*)"], "additionalDirectories": ["../shared"] }
}"#,
        );
        write(&folder.join("CODEBUDDY.md"), "# Project\n");
        write(&folder.join(".codebuddy/CODEBUDDY.md"), "# Inner\n");
        let context = |args: &str| Context {
            engine: "codebuddy".into(),
            account: "live-test".into(),
            conversation: "live-test".into(),
            folder: Some(folder.clone()),
            session: None,
            args: args.into(),
            db: db.clone(),
        };
        let mut shown = Vec::new();
        for name in [
            "agents",
            "hooks",
            "memory",
            "permissions",
            "feedback",
            "upgrade",
        ] {
            let outcome = run(context(""), name).await;
            let text = match &outcome {
                Ok(output) => serde_json::to_string_pretty(output).unwrap(),
                Err(error) => format!("ERROR: {error}"),
            };
            println!("\n===== codebuddy /{name}\n{text}");
            shown.push((name, outcome.expect(name)));
        }
        let text = |name: &str| {
            serde_json::to_string(&shown.iter().find(|(n, _)| *n == name).unwrap().1).unwrap()
        };
        assert!(text("agents").contains("Reviews the diff"));
        assert!(text("hooks").contains("echo stop"));
        assert!(text("memory").contains(".codebuddy/CODEBUDDY.md"));
        assert!(
            text("permissions").contains("Bash(curl:*)")
                && text("permissions").contains("../shared")
        );
        for name in ["feedback", "upgrade"] {
            match &shown.iter().find(|(n, _)| *n == name).unwrap().1 {
                Output::Open { target } => assert!(target.starts_with("url:https://"), "{target}"),
                other => panic!("{name}: {other:?}"),
            }
        }
    }
}
