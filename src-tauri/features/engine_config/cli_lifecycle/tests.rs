// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
use super::*;

#[test]
fn parse_version_extracts_first_digit_run() {
    assert_eq!(parse_version("2.1.228 (Claude Code)"), Some((2, 1, 228)));
    assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
    assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
    assert_eq!(parse_version("no digits"), None);
}

#[test]
fn sign_in_comes_from_the_cli_answer() {
    let output = |stdout: &str, code: i32| ProcOutput {
        status: Some(exit_status(code)),
        stdout: stdout.into(),
        stderr: String::new(),
        timed_out: false,
    };
    assert_eq!(
        parse_sign_in(&output(r#"{"loggedIn":true,"email":"a@example.com"}"#, 0)),
        (Some(true), Some("a@example.com".into()))
    );
    assert_eq!(
        parse_sign_in(&output(r#"{"loggedIn":false}"#, 1)).0,
        Some(false)
    );
    assert_eq!(
        parse_sign_in(&output("Logged in using ChatGPT", 0)).0,
        Some(true)
    );
    assert_eq!(parse_sign_in(&output("Not logged in", 0)).0, Some(false));
    assert_eq!(parse_sign_in(&output("", 1)).0, Some(false));
    assert!(sign_in_status_args("claude").is_some());
    assert!(sign_in_status_args("gemini").is_none());
}

#[cfg(unix)]
fn exit_status(code: i32) -> std::process::ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code << 8)
}

#[cfg(windows)]
fn exit_status(code: i32) -> std::process::ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(code as u32)
}

#[test]
fn engines_start_as_their_own_program() {
    assert_eq!(cli_binary_name("qoder"), "qodercli");
    assert_eq!(cli_binary_name("qoder-cn"), "qoderclicn");
    assert_eq!(cli_binary_name("minimax"), "mcode");
    assert_eq!(cli_binary_name("claude"), "claude");
}

#[test]
fn npm_package_covers_every_npm_engine() {
    for engine in ["claude", "kimi", "codex", "pi", "omp", "dsh", "opencode"] {
        assert!(npm_package(engine).is_some(), "{engine} missing package");
    }
    assert_eq!(npm_package("grok"), None);
    assert_eq!(npm_package("agy"), None);
    // qodercli/qoderclicn ship via their own installer (like grok/agy):
    // no npm lifecycle.
    assert_eq!(npm_package("qoder"), None);
    assert_eq!(npm_package("qoder-cn"), None);
}

#[cfg(unix)]
#[tokio::test]
async fn run_streaming_emits_scoped_lines_then_finished() {
    use std::sync::Mutex as StdMutex;

    use support::Emit;

    struct Collector {
        raws: StdMutex<Vec<String>>,
    }
    impl Emit for Collector {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.raws
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(raw_json.to_string());
        }
    }

    let collector = Arc::new(Collector {
        raws: StdMutex::new(Vec::new()),
    });
    let reporter = ProgressReporter::with_sink(
        collector.clone(),
        "run-test".to_string(),
        "kimi".to_string(),
    );
    let mut command = Command::new("bash");
    command.args(["-c", "printf 'out1\\nout2\\n'; printf 'err1\\n' >&2"]);

    let output = run_streaming(&mut command, Duration::from_secs(10), &reporter)
        .await
        .unwrap();

    // Captured text is unchanged from run_capture semantics.
    assert_eq!(output.stdout, "out1\nout2\n");
    assert_eq!(output.stderr, "err1\n");
    assert_eq!(output.status.map(|s| s.success()), Some(true));
    assert!(!output.timed_out);

    // Events arrive as JSON arrays; flatten them.
    let events: Vec<serde_json::Value> = collector
        .raws
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .flat_map(|raw| serde_json::from_str::<Vec<serde_json::Value>>(raw).unwrap())
        .collect();
    // Every event carries the run scope.
    assert!(events.iter().all(|e| e["runId"] == "run-test"));
    assert_eq!(events.first().unwrap()["phase"], "started");
    assert_eq!(events.last().unwrap()["phase"], "finished");
    assert_eq!(events.last().unwrap()["exitOk"], true);
    let lines: Vec<(&str, &str)> = events
        .iter()
        .filter(|e| e["phase"] == "stdout" || e["phase"] == "stderr")
        .map(|e| (e["phase"].as_str().unwrap(), e["line"].as_str().unwrap()))
        .collect();
    assert_eq!(
        lines,
        vec![("stdout", "out1"), ("stdout", "out2"), ("stderr", "err1")]
    );
}

/// Windows npm globals are `%APPDATA%\npm\<cli>.cmd` shims next to a
/// `node_modules` tree; the shim path itself has no `node_modules` in it,
/// so the old check pushed npm users onto the official-installer channel.
#[test]
fn npm_global_shims_are_the_npm_channel() {
    let root = std::env::temp_dir().join(format!("misty-npm-shim-{}", uuid::Uuid::new_v4()));
    let prefix = root.join("npm");
    std::fs::create_dir_all(prefix.join("node_modules/@anthropic-ai/claude-code")).unwrap();
    std::fs::create_dir_all(prefix.join("node_modules/@openai/codex")).unwrap();
    std::fs::write(prefix.join("claude.cmd"), "@echo off\r\n").unwrap();
    std::fs::write(prefix.join("codex.cmd"), "@echo off\r\n").unwrap();
    let standalone = root.join("bin");
    std::fs::create_dir_all(&standalone).unwrap();
    std::fs::write(standalone.join("claude.exe"), "").unwrap();

    let shim = |name: &str| prefix.join(name).to_string_lossy().into_owned();
    assert_eq!(update_kind("claude", &shim("claude.cmd")), Some("npm"));
    assert_eq!(update_kind("codex", &shim("codex.cmd")), Some("npm"));
    let exe = standalone.join("claude.exe").to_string_lossy().into_owned();
    assert_eq!(update_kind("claude", &exe), Some("native"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn terminal_shell_kinds_follow_the_shell_binary() {
    for (path, kind) in [
        ("/bin/zsh", ShellKind::Posix),
        ("/usr/local/bin/bash", ShellKind::Posix),
        ("C:\\Program Files\\Git\\bin\\bash.exe", ShellKind::Posix),
        ("/opt/homebrew/bin/fish", ShellKind::Fish),
        ("C:\\Windows\\System32\\cmd.exe", ShellKind::Cmd),
        (
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            ShellKind::PowerShell,
        ),
        (
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            ShellKind::PowerShell,
        ),
        ("/usr/bin/nu", ShellKind::Other),
    ] {
        assert_eq!(shell_kind(path), kind, "{path}");
    }
}

/// The official installers now run where the user can see them — typed
/// into the built-in terminal — never as a hidden `-ExecutionPolicy
/// Bypass` PowerShell child of the GUI (a download-and-execute pattern
/// endpoint security flags).
#[test]
fn native_installs_are_typed_into_the_terminal_without_bypass() {
    let done = regex::Regex::new(r"__MISTY_CLI_DONE__\d").unwrap();
    for engine in ["claude", "codex"] {
        for (kind, windows) in [
            (ShellKind::Posix, false),
            (ShellKind::Fish, false),
            (ShellKind::PowerShell, false),
            (ShellKind::Cmd, true),
            (ShellKind::PowerShell, true),
            (ShellKind::Posix, true),
            (ShellKind::Other, false),
        ] {
            let line = native_terminal_line(engine, kind, windows);
            assert!(!line.contains("Bypass"), "{line}");
            assert!(!line.contains("ExecutionPolicy"), "{line}");
            assert!(!line.contains('\n') && !line.contains('\r'), "{line}");
            // The typed line itself must never look like a finished run.
            assert!(!done.is_match(&line), "{line}");
            let host = if engine == "codex" {
                "chatgpt.com/codex"
            } else {
                "claude.ai"
            };
            assert!(line.contains(host), "{line}");
        }
    }
    // pipefail inside an explicit bash: a failed download must not read
    // as success (the pipe's status is the last command's), and the
    // user's own interactive shell options stay untouched.
    assert_eq!(
        native_terminal_line("claude", ShellKind::Posix, false),
        "bash -c 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash'; echo \"__MISTY_CLI_DONE__$?\""
    );
    // The terminal opens in the workspace and cmd resolves commands from
    // the current directory first: a bare `powershell` would run a
    // repo-planted powershell.bat. Always the absolute system path.
    // SystemRoot varies in case (C:\\WINDOWS on many machines).
    let exe = windows_powershell_path();
    assert!(
        exe.ends_with("\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
        "{exe}"
    );
    assert_eq!(
        native_terminal_line("claude", ShellKind::Cmd, true),
        format!("\"{exe}\" -NoProfile -Command \"irm https://claude.ai/install.ps1 | iex\" && echo __MISTY_CLI_DONE_^_0 || echo __MISTY_CLI_DONE_^_1")
    );
    assert_eq!(
        native_terminal_line("claude", ShellKind::Posix, true),
        format!("'{}' -NoProfile -Command \"irm https://claude.ai/install.ps1 | iex\"; echo \"__MISTY_CLI_DONE__$?\"", exe.replace('\\', "/"))
    );
    for kind in [
        ShellKind::Cmd,
        ShellKind::Posix,
        ShellKind::Fish,
        ShellKind::Other,
    ] {
        let line = native_terminal_line("codex", kind, true);
        assert!(!line.starts_with("powershell"), "{line}");
    }
    assert_eq!(
        native_terminal_line("codex", ShellKind::PowerShell, true),
        "irm https://chatgpt.com/codex/install.ps1 | iex; \"__MISTY_CLI_DONE__$(if ($?) { 0 } else { 1 })\""
    );
    // Unknown shells get the bare official command: no marker syntax to
    // get wrong, completion is then picked up when the tab closes.
    assert_eq!(
        native_terminal_line("claude", ShellKind::Other, false),
        "curl -fsSL https://claude.ai/install.sh | bash"
    );
}

/// A bare command name has no install directory: resolving
/// `node_modules` against the app's working directory would let any
/// folder named that way decide the channel.
#[test]
fn npm_shim_detection_ignores_relative_paths() {
    let base = std::path::PathBuf::from("target")
        .join(format!("misty-npm-shim-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(base.join("node_modules").join("@anthropic-ai/claude-code"))
        .unwrap();
    let relative = base.join("claude");
    assert!(!beside_npm_package("claude", &relative.to_string_lossy()));
    let absolute = std::fs::canonicalize(&base).unwrap().join("claude");
    assert!(beside_npm_package("claude", &absolute.to_string_lossy()));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn only_npm_runs_inside_the_app() {
    assert_eq!(run_location("npm"), Some(RunLocation::App));
    assert_eq!(run_location("native"), Some(RunLocation::Terminal));
    assert_eq!(run_location("none"), None);
}

#[test]
fn update_kind_matches_distribution_channel() {
    // npm engines always update through npm, regardless of binary path.
    assert_eq!(update_kind("dsh", "/usr/local/bin/dsh"), Some("npm"));
    // grok has no lifecycle action.
    assert_eq!(update_kind("grok", "/usr/local/bin/grok"), None);
    assert_eq!(update_kind("agy", "/usr/local/bin/agy"), None);
    // claude / codex: a node_modules path means the npm distribution;
    // anything else uses the official standalone installer.
    assert_eq!(
        update_kind(
            "claude",
            "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"
        ),
        Some("npm")
    );
    assert_eq!(update_kind("codex", "/usr/local/bin/codex"), Some("native"));
    assert_eq!(
        update_kind(
            "codex",
            "/usr/local/lib/node_modules/@openai/codex/bin/codex.js"
        ),
        Some("npm")
    );
}
