// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::*;
use crate::engine_config::usage_stats::sources::{default_specs, discover, status_of};

fn status_for(engine: Engine) -> crate::engine_config::usage_stats::types::SourceStatus {
    let spec = default_specs()
        .into_iter()
        .find(|s| s.engine == engine)
        .unwrap();
    status_of(&spec, &discover(&spec), Some(42))
}

#[test]
fn default_roots_follow_home_and_engine_env() {
    let scratch = Scratch::new("sources-home");
    let home = scratch.path("home");
    std::fs::create_dir_all(&home).unwrap();
    let _guard = crate::engine_config::support::TestHome::set(&home);

    let specs = default_specs();
    let ids: Vec<&str> = specs.iter().map(|s| s.engine.id()).collect();
    assert_eq!(ids, ["claude", "codex", "pi", "omp"]);
    assert_eq!(specs[0].roots, [home.join(".claude/projects")]);
    assert_eq!(
        specs[1].roots,
        [
            home.join(".codex/sessions"),
            home.join(".codex/archived_sessions")
        ]
    );
    assert_eq!(specs[2].roots, [home.join(".pi/agent/sessions")]);
    assert_eq!(specs[3].roots, [home.join(".omp/agent/sessions")]);

    let missing = status_for(Engine::Claude);
    assert_eq!((missing.status.as_str(), missing.files), ("missing", 0));
    assert_eq!(missing.env.as_deref(), Some("CLAUDE_CONFIG_DIR"));
    assert_eq!(missing.label, "Claude Code");

    write_lines(
        &home.join(".codex/sessions/2026/10/27/rollout-a.jsonl"),
        &[codex_meta("a", "/w", None)],
    );
    write_lines(
        &home.join(".codex/archived_sessions/rollout-b.jsonl"),
        &[codex_meta("b", "/w", None)],
    );
    let codex = status_for(Engine::Codex);
    assert_eq!(
        (codex.status.as_str(), codex.files, codex.last_scan_at),
        ("ok", 2, Some(42))
    );
    assert_eq!(codex.roots.len(), 2, "sessions + archived");

    let relocated = scratch.path("claude-elsewhere");
    write_lines(
        &relocated.join("projects/p/s.jsonl"),
        &[pi_header("x", "/w")],
    );
    std::env::set_var("CLAUDE_CONFIG_DIR", &relocated);
    let claude = status_for(Engine::Claude);
    assert_eq!(
        claude.roots,
        [relocated.join("projects").to_string_lossy().into_owned()]
    );
    assert_eq!((claude.status.as_str(), claude.files), ("ok", 1));
}

#[cfg(unix)]
#[test]
fn unreadable_root_reports_denied_and_absent_root_missing() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new("sources-denied");
    let root = scratch.path("sessions");
    std::fs::create_dir_all(root.join("w")).unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o000)).unwrap();
    let locked = spec(Engine::Pi, &root);
    let denied = status_of(&locked, &discover(&locked), None);
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
    // uid 0 reads anything; the permission check is meaningless there.
    if denied.status != "ok" {
        assert_eq!(denied.status, "denied");
        assert!(denied.error.unwrap().contains("sessions"));
    }

    let absent = spec(Engine::Pi, &scratch.path("nope"));
    let missing = status_of(&absent, &discover(&absent), None);
    assert_eq!((missing.status.as_str(), missing.error), ("missing", None));
}
