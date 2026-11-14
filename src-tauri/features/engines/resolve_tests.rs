// Tests for resolve.rs (moved out of it).
use super::*;

/// macOS checks a new program on its first launch, which under the full suite's load could
/// stall past the probe's 2s budget: each fake `npm` runs once (`npm warm`) before it's timed.
#[cfg(unix)]
fn fake_npm(script: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("ccgui npm probe {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let binary = root.join("npm");
    let script = format!("#!/bin/sh\n[ \"$1\" = warm ] && exit 0\n{script}\n");
    std::fs::write(&binary, script).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    let warm = std::process::Command::new(&binary).arg("warm").output();
    assert!(warm.unwrap().status.success(), "fake npm warm-up failed");
    root
}

#[cfg(unix)]
#[test]
fn npm_probe_times_out_and_reaps_child() {
    let root =
        fake_npm("echo $$ > \"$0.pid\"; /bin/sleep 4 & echo $! > \"$0.child\"; wait; printf /late");
    let started = Instant::now();
    let result = discover_npm_global_bin_dir(&[root.clone(), PathBuf::from("/bin")]);
    let elapsed = started.elapsed();
    let pid: i32 = std::fs::read_to_string(root.join("npm.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let descendant: u32 = std::fs::read_to_string(root.join("npm.child"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let mut status = 0;
    let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
    let wait_error = std::io::Error::last_os_error().raw_os_error();
    std::fs::remove_dir_all(root).unwrap();
    assert!(
        result.is_none(),
        "timed-out npm must not supply a prefix: {result:?}"
    );
    assert!(elapsed < Duration::from_secs(3), "probe took {elapsed:?}");
    assert_eq!(waited, -1);
    assert_eq!(wait_error, Some(libc::ECHILD));
    let mut system = sysinfo::System::new();
    let descendant = sysinfo::Pid::from_u32(descendant);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[descendant]), true);
    assert!(
        system.process(descendant).map_or(true, |process| {
            process.status() == sysinfo::ProcessStatus::Zombie
        }),
        "timed-out npm left a running descendant"
    );
}

#[cfg(unix)]
#[test]
fn npm_probe_does_not_wait_for_descendant_stdout() {
    let root = fake_npm("/bin/sleep 4 &\nprintf '/prefix with spaces\\n'");
    let started = Instant::now();
    let result = discover_npm_global_bin_dir(&[root.clone(), PathBuf::from("/bin")]);
    let elapsed = started.elapsed();
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(result, Some(PathBuf::from("/prefix with spaces/bin")));
    assert!(
        elapsed < NPM_PROBE_TIMEOUT,
        "stdout outlived npm: {elapsed:?}"
    );
}

#[cfg(unix)]
#[test]
fn npm_probe_rejects_failed_command() {
    let root = fake_npm("printf /invalid; exit 1");
    let result = discover_npm_global_bin_dir(&[root.clone(), PathBuf::from("/bin")]);
    std::fs::remove_dir_all(root).unwrap();
    assert!(result.is_none());
}

#[cfg(unix)]
#[test]
fn cli_search_path_covers_well_known_unix_bins() {
    let path = cli_search_path();
    let joined = path.to_string_lossy();
    assert!(
        joined.contains("/usr/local/bin")
            || joined.contains("/opt/homebrew/bin")
            || joined.contains(".local/bin"),
        "cli_search_path missing well-known dirs: {joined}"
    );
}

/// Regression: absolute shebang shim + launchd-like PATH → `env: node: No
/// such file`. Injecting the search PATH (as plugin_exec does) fixes it.
#[cfg(unix)]
#[test]
fn cli_search_path_lets_env_shebang_find_interpreter() {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;

    let root = std::env::temp_dir().join(format!("ccgui-shebang-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let node = root.join("node");
    std::fs::write(&node, "#!/bin/sh\nprintf ok\n").unwrap();
    std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
    let shim = root.join("tool");
    std::fs::write(&shim, "#!/usr/bin/env node\n").unwrap();
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();

    let bare = Command::new(&shim)
        .env("PATH", "/usr/bin:/bin")
        .output()
        .expect("spawn bare");
    assert!(
        !bare.status.success(),
        "launchd-like PATH must fail shebang; stdout={:?} stderr={:?}",
        String::from_utf8_lossy(&bare.stdout),
        String::from_utf8_lossy(&bare.stderr)
    );

    let mut dirs = vec![root.clone()];
    for part in std::env::split_paths(&cli_search_path()) {
        push_unique_path(&mut dirs, part);
    }
    let enriched = std::env::join_paths(&dirs).unwrap();
    let fixed = Command::new(&shim)
        .env("PATH", &enriched)
        .output()
        .expect("spawn enriched");
    let _ = std::fs::remove_dir_all(&root);
    assert!(
        fixed.status.success(),
        "enriched PATH should run shebang; stderr={}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&fixed.stdout), "ok");
}

#[cfg(unix)]
#[test]
fn npm_probe_stops_unlimited_output_before_timeout() {
    let root = fake_npm("while :; do printf '%1024s' x; done");
    let started = Instant::now();
    let result = discover_npm_global_bin_dir(&[root.clone(), PathBuf::from("/bin")]);
    let elapsed = started.elapsed();
    std::fs::remove_dir_all(root).unwrap();
    assert!(result.is_none());
    assert!(
        elapsed < NPM_PROBE_TIMEOUT,
        "output budget took {elapsed:?}"
    );
}

#[cfg(unix)]
#[test]
fn npm_probe_reap_is_bounded_for_running_child() {
    let mut child = {
        let runtime = tauri::async_runtime::handle();
        let _entered = runtime.inner().enter();
        Command::new("/bin/sleep")
            .arg("4")
            .kill_on_drop(true)
            .spawn()
            .unwrap()
    };
    let started = Instant::now();
    let reaped = reap_npm_probe(&mut child, Duration::from_millis(20));
    let elapsed = started.elapsed();
    child.start_kill().unwrap();
    assert!(reap_npm_probe(&mut child, NPM_REAP_TIMEOUT));
    assert!(!reaped);
    assert!(elapsed < Duration::from_secs(1), "reap took {elapsed:?}");
}

#[cfg(windows)]
#[test]
fn npm_probe_windows_cmd_supports_spaces_and_timeout() {
    let root = std::env::temp_dir().join(format!("ccgui npm probe {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let binary = root.join("npm.cmd");
    let mut paths = vec![root.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    std::fs::write(&binary, "@echo off\r\necho C:\\prefix with spaces\r\n").unwrap();
    let prefix = discover_npm_global_bin_dir(&paths);
    std::fs::write(
        &binary,
        "@echo off\r\nping -n 8 127.0.0.1 > nul\r\necho C:\\late\r\n",
    )
    .unwrap();
    let started = Instant::now();
    let timeout = discover_npm_global_bin_dir(&paths);
    let elapsed = started.elapsed();
    std::fs::write(
        &binary,
        "@echo off\r\n:output\r\necho repeated-prefix-output\r\ngoto output\r\n",
    )
    .unwrap();
    let output_started = Instant::now();
    let oversized = discover_npm_global_bin_dir(&paths);
    let output_elapsed = output_started.elapsed();
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(prefix, Some(PathBuf::from(r"C:\prefix with spaces")));
    assert!(timeout.is_none());
    assert!(elapsed < Duration::from_secs(6), "probe took {elapsed:?}");
    assert!(oversized.is_none());
    assert!(
        output_elapsed < NPM_PROBE_TIMEOUT,
        "output budget took {output_elapsed:?}"
    );
}

#[cfg(windows)]
#[test]
fn npm_probe_windows_sweeps_descendant_after_parent_exit() {
    let root = std::env::temp_dir().join(format!("ccgui npm orphan {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("child.cmd"),
        "@echo off\r\nping -n 5 127.0.0.1 > nul\r\necho leaked > \"%~dp0leaked\"\r\n",
    )
    .unwrap();
    std::fs::write(
        root.join("npm.cmd"),
        "@echo off\r\nstart \"\" /b cmd /d /c call \"%~dp0child.cmd\"\r\nping -n 2 127.0.0.1 > nul\r\necho C:\\prefix\r\n",
    )
    .unwrap();
    let mut paths = vec![root.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let prefix = discover_npm_global_bin_dir(&paths);
    std::thread::sleep(Duration::from_secs(5));
    let leaked = root.join("leaked").exists();
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(prefix, Some(PathBuf::from(r"C:\prefix")));
    assert!(!leaked, "descendant survived the npm wrapper");
}

#[test]
fn npm_prefix_resolution_uses_bin_on_unix() {
    #[cfg(not(windows))]
    {
        let resolved = resolve_npm_global_bin_dir_from_prefix("/Users/demo/.npm-global").unwrap();
        assert_eq!(resolved, PathBuf::from("/Users/demo/.npm-global/bin"));
    }
}

#[test]
fn npm_prefix_resolution_ignores_empty_values() {
    assert!(resolve_npm_global_bin_dir_from_prefix("").is_none());
    assert!(resolve_npm_global_bin_dir_from_prefix("undefined").is_none());
    assert!(resolve_npm_global_bin_dir_from_prefix("null").is_none());
}

#[test]
fn prefer_windows_executable_variant_prefers_cmd_over_posix_shim() {
    let root = std::env::temp_dir().join(format!("ccgui-posix-shim-{}", std::process::id()));
    std::fs::create_dir_all(&root).expect("create temp dir");
    let posix_shim = root.join("dsh");
    let cmd_path = root.join("dsh.cmd");
    std::fs::write(&posix_shim, "#!/bin/sh\n").expect("write shim");
    std::fs::write(&cmd_path, "@echo off\n").expect("write cmd");

    assert_eq!(
        prefer_windows_executable_variant(posix_shim.clone()),
        cmd_path
    );
    // Already-executable variants and missing dirs pass through.
    assert_eq!(
        prefer_windows_executable_variant(cmd_path.clone()),
        cmd_path
    );
    let missing = PathBuf::from(r"C:\definitely\missing\dsh");
    assert_eq!(prefer_windows_executable_variant(missing.clone()), missing);

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn windows_wrapper_maps_batch_and_ps1() {
    let (program, leading) = windows_wrapper(r"C:\npm\claude.cmd").unwrap();
    assert_eq!(program, "cmd");
    assert_eq!(leading, vec!["/c", r"C:\npm\claude.cmd"]);

    let (program, leading) = windows_wrapper(r"C:\npm\claude.BAT").unwrap();
    assert_eq!(program, "cmd");
    assert_eq!(leading[0], "/c");

    let (program, leading) = windows_wrapper(r"C:\npm\claude.ps1").unwrap();
    assert_eq!(program, "powershell");
    assert_eq!(
        leading,
        vec![
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            r"C:\npm\claude.ps1"
        ]
    );

    assert!(windows_wrapper(r"C:\npm\claude.exe").is_none());
    assert!(windows_wrapper("/usr/local/bin/claude").is_none());
}

#[test]
fn windows_extra_search_paths_cover_npm_global_dir() {
    let user_profile = Path::new(r"C:\Users\demo");
    let appdata = Path::new(r"C:\Users\demo\AppData\Roaming");
    let local_app_data = Path::new(r"C:\Users\demo\AppData\Local");
    let paths = build_windows_extra_search_paths(
        Some(appdata),
        Some(user_profile),
        Some(local_app_data),
        None,
        None,
    );
    let normalized: Vec<String> = paths
        .iter()
        .map(|path| path.to_string_lossy().replace('/', "\\"))
        .collect();
    for expected in [
        r"C:\Users\demo\AppData\Roaming\npm",
        r"C:\Users\demo\.local\bin",
        r"C:\Users\demo\scoop\shims",
    ] {
        assert!(
            normalized.iter().any(|p| p == expected),
            "missing {expected} in {normalized:?}"
        );
    }
}

#[test]
fn strip_verbatim_drops_local_prefix_and_keeps_unc() {
    assert_eq!(
        strip_verbatim(PathBuf::from(r"\\?\C:\npm\claude.cmd")),
        PathBuf::from(r"C:\npm\claude.cmd")
    );
    let unc = PathBuf::from(r"\\?\UNC\server\share\claude.cmd");
    assert_eq!(strip_verbatim(unc.clone()), unc);
    let plain = PathBuf::from(r"C:\npm\claude.cmd");
    assert_eq!(strip_verbatim(plain.clone()), plain);
}

#[test]
fn windows_extra_search_paths_cover_openai_codex_installer() {
    // The Programs dir must exist for the installer path to be pushed;
    // emulate %LOCALAPPDATA% with a temp dir.
    let temp = std::env::temp_dir().join(format!("ccgui-openai-codex-{}", std::process::id()));
    let programs = temp.join("Programs");
    std::fs::create_dir_all(&programs).expect("create Programs dir");

    let paths = build_windows_extra_search_paths(None, None, Some(&temp), None, None);
    let expected = programs.join("OpenAI\\Codex\\bin");
    assert!(
        paths.iter().any(|p| p == &expected),
        "missing {} in {paths:?}",
        expected.display()
    );

    let _ = std::fs::remove_dir_all(temp);
}

#[test]
fn windows_extra_search_paths_cover_codemoss_bundled_claude() {
    let temp = std::env::temp_dir().join(format!("ccgui-codemoss-sdk-{}", std::process::id()));
    // Build the expectation the same way the resolver does: the
    // read_dir entry joins with a platform separator, so the final
    // segment is its own component even though the parents carry
    // Windows-style literals.
    let scope_dir = temp.join(".codemoss\\dependencies\\claude-sdk\\node_modules\\@anthropic-ai");
    let sdk_dir = scope_dir.join("claude-agent-sdk-win32-x64");
    std::fs::create_dir_all(&sdk_dir).expect("create sdk dir");
    // An unrelated package under the same scope must not be picked up.
    std::fs::create_dir_all(scope_dir.join("sdk")).expect("create unrelated dir");

    let paths = build_windows_extra_search_paths(None, Some(&temp), None, None, None);
    assert!(
        paths.iter().any(|p| p == &sdk_dir),
        "missing {} in {paths:?}",
        sdk_dir.display()
    );

    let _ = std::fs::remove_dir_all(temp);
}

#[test]
fn expand_windows_env_vars_resolves_known_and_keeps_unknown() {
    std::env::set_var("CCGUI_TEST_EXPAND_ROOT", r"C:\Users\demo");
    let expanded = expand_windows_env_vars(
        r"%CCGUI_TEST_EXPAND_ROOT%\bin;C:\tools;%CCGUI_NO_SUCH_VAR%\x;100%",
    );
    assert_eq!(
        expanded,
        r"C:\Users\demo\bin;C:\tools;%CCGUI_NO_SUCH_VAR%\x;100%"
    );
    std::env::remove_var("CCGUI_TEST_EXPAND_ROOT");
}

#[test]
fn parse_registry_path_value_splits_and_expands() {
    std::env::set_var("CCGUI_TEST_PATH_ROOT", r"C:\Users\demo");
    let paths = parse_registry_path_value(
        r"C:\Windows;;%CCGUI_TEST_PATH_ROOT%\AppData\Local\Programs\OpenAI\Codex\bin; ",
    );
    assert_eq!(
        paths,
        vec![
            PathBuf::from(r"C:\Windows"),
            PathBuf::from(r"C:\Users\demo\AppData\Local\Programs\OpenAI\Codex\bin"),
        ]
    );
    std::env::remove_var("CCGUI_TEST_PATH_ROOT");
}

#[test]
fn resolve_launchable_cli_binary_passthrough_rules() {
    assert_eq!(resolve_launchable_cli_binary(""), "");
    // Missing absolute paths stay as-is so the spawn error names them.
    let missing = if cfg!(windows) {
        r"C:\definitely\missing\claude.cmd"
    } else {
        "/definitely/missing/claude"
    };
    assert_eq!(resolve_launchable_cli_binary(missing), missing);
}
