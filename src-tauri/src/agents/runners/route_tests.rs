use super::{
    detect::EngineStatus,
    events::RateLimit,
    route::{route, RouteNeed, RoutePrefs},
    EngineId, LaunchMode,
};

fn ok(engine: &'static str) -> EngineStatus {
    EngineStatus {
        engine,
        installed: true,
        signed_in: true,
        version: "1.0".into(),
    }
}

fn need(mode: LaunchMode, permission: &str) -> RouteNeed {
    RouteNeed {
        mode,
        permission: permission.into(),
        grants: vec![],
    }
}

fn prefs(default: EngineId, fallback: Option<EngineId>) -> RoutePrefs {
    RoutePrefs {
        default: Some(default),
        fallback,
        cap_percent: Some(35.0),
    }
}

#[test]
fn uses_the_default_when_it_qualifies() {
    let statuses = [ok("claude"), ok("codex")];
    assert_eq!(
        route(
            &prefs(EngineId::Claude, Some(EngineId::Codex)),
            &statuses,
            &[],
            &need(LaunchMode::Ask, "ask")
        ),
        Ok(EngineId::Claude)
    );
}

#[test]
fn falls_back_when_the_default_is_missing_signed_out_or_capped() {
    let codex_only = [ok("codex")];
    assert_eq!(
        route(
            &prefs(EngineId::Claude, Some(EngineId::Codex)),
            &codex_only,
            &[],
            &need(LaunchMode::Ask, "ask")
        ),
        Ok(EngineId::Codex)
    );
    let signed_out = [
        EngineStatus {
            signed_in: false,
            ..ok("claude")
        },
        ok("codex"),
    ];
    assert_eq!(
        route(
            &prefs(EngineId::Claude, Some(EngineId::Codex)),
            &signed_out,
            &[],
            &need(LaunchMode::Ask, "ask")
        ),
        Ok(EngineId::Codex)
    );
    let capped = [(
        EngineId::Codex,
        RateLimit {
            used_percent: 40.0,
            window: "weekly".into(),
            resets_at: None,
        },
    )];
    assert_eq!(
        route(
            &prefs(EngineId::Codex, Some(EngineId::Claude)),
            &[ok("codex"), ok("claude")],
            &capped,
            &need(LaunchMode::Ask, "auto")
        ),
        Ok(EngineId::Claude)
    );
}

#[test]
fn explains_in_plain_words_when_nothing_qualifies() {
    let reason = route(
        &prefs(EngineId::Claude, None),
        &[],
        &[],
        &need(LaunchMode::Ask, "ask"),
    )
    .unwrap_err();
    assert_eq!(reason, "Claude Code isn't installed on this computer.");
    assert!(route(
        &RoutePrefs::default(),
        &[ok("claude")],
        &[],
        &need(LaunchMode::Ask, "ask")
    )
    .unwrap_err()
    .contains("Pick a coding tool"));
}

#[test]
fn launch_only_tools_only_plan_in_ask() {
    let statuses = [ok("agy")];
    assert!(route(
        &prefs(EngineId::Agy, None),
        &statuses,
        &[],
        &need(LaunchMode::Ask, "ask")
    )
    .is_err());
    assert_eq!(
        route(
            &prefs(EngineId::Agy, None),
            &statuses,
            &[],
            &need(LaunchMode::Plan, "ask")
        ),
        Ok(EngineId::Agy)
    );
    assert_eq!(
        route(
            &prefs(EngineId::Agy, None),
            &statuses,
            &[],
            &need(LaunchMode::AutoEdit, "auto")
        ),
        Ok(EngineId::Agy)
    );
}

#[test]
fn grok_needs_auto_outside_plan() {
    let statuses = [ok("grok")];
    let auto = need(LaunchMode::AutoEdit, "auto");
    assert_eq!(
        route(&prefs(EngineId::Grok, None), &statuses, &[], &auto),
        Ok(EngineId::Grok)
    );
    let reason = route(
        &prefs(EngineId::Grok, None),
        &statuses,
        &[],
        &need(LaunchMode::AutoEdit, "ask"),
    )
    .unwrap_err();
    assert!(reason.contains("Grok can't ask before acting"));
    assert!(route(
        &prefs(EngineId::Grok, None),
        &statuses,
        &[],
        &need(LaunchMode::Plan, "auto")
    )
    .is_err());
}

#[test]
fn reads_the_github_remote_as_owner_and_name() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".git")).unwrap();
    let config = dir.path().join(".git/config");
    std::fs::write(
        &config,
        "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = git@github.com:misty-org/misty.git\n",
    )
    .unwrap();
    assert_eq!(
        super::tauri_host::github_remote(dir.path()).as_deref(),
        Some("misty-org/misty")
    );
    std::fs::write(
        &config,
        "[remote \"origin\"]\n\turl = https://github.com/misty-org/misty\n",
    )
    .unwrap();
    assert_eq!(
        super::tauri_host::github_remote(dir.path()).as_deref(),
        Some("misty-org/misty")
    );
    std::fs::write(
        &config,
        "[remote \"origin\"]\n\turl = https://gitlab.com/a/b.git\n",
    )
    .unwrap();
    assert_eq!(super::tauri_host::github_remote(dir.path()), None);
}
