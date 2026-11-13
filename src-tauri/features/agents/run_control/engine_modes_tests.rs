use super::*;
use crate::engines::{engine_by_id, SendRequest};

/// Every flag an engine takes to stop asking for permission.
const SKIP_FLAGS: &[&str] = &[
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
    "-y",
    "--yolo",
    "--always-approve",
    "--auto-approve",
    "bypass_permissions",
    "--plan-yolo",
];

const MODES: [EngineMode; 4] = [
    EngineMode::Ask,
    EngineMode::Auto,
    EngineMode::Plan,
    EngineMode::Bypass,
];

fn request(permission: &str) -> SendRequest {
    SendRequest {
        session_id: None,
        workspace: std::env::temp_dir(),
        prompt: "hello".into(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: None,
        effort: None,
        service_tier: None,
        permission: Some(permission.into()),
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    }
}

/// The command line the engine is started with for this permission level, local folder.
fn argv(engine: &dyn Engine, permission: &str) -> Option<Vec<String>> {
    let req = request(permission);
    let built = if engine.drives_own_transport() {
        engine.host_command(&req, engine.id())
    } else {
        engine.build_command(&req, engine.id())
    }
    .ok()?;
    let command = built.command.as_std();
    let mut args: Vec<String> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    if let Some(payload) = built.stdin_payload {
        args.push(payload);
    }
    for path in built.cleanup_files {
        let _ = std::fs::remove_file(path);
    }
    Some(args)
}

#[test]
fn only_bypass_passes_an_engines_skip_permissions_flag() {
    for id in crate::engines::support::config::ENGINES {
        let engine = engine_by_id(id).expect("known engine");
        for mode in MODES {
            let Ok(level) = permission_for(engine.as_ref(), mode) else {
                continue;
            };
            if mode != EngineMode::Bypass {
                assert_ne!(level, "bypass", "{id} {mode:?}");
            }
            let Some(args) = argv(engine.as_ref(), level) else {
                continue;
            };
            let skipped = args.iter().any(|arg| SKIP_FLAGS.contains(&arg.as_str()));
            if mode != EngineMode::Bypass {
                assert!(!skipped, "{id} in {mode:?} passed a skip flag: {args:?}");
            }
        }
    }
}

#[test]
fn bypass_passes_the_engines_own_flag() {
    for (id, flag) in [
        ("claude", "--dangerously-skip-permissions"),
        ("codebuddy", "-y"),
        ("agy", "--dangerously-skip-permissions"),
        ("grok", "--always-approve"),
        ("omp", "--auto-approve"),
        ("gemini", "--yolo"),
        ("qwen", "--yolo"),
    ] {
        let engine = engine_by_id(id).unwrap();
        let level = permission_for(engine.as_ref(), EngineMode::Bypass).unwrap();
        let args = argv(engine.as_ref(), level).unwrap();
        assert!(args.contains(&flag.to_string()), "{id}: {args:?}");
    }
}

#[test]
fn every_engine_offers_auto_or_bypass_and_ask_only_where_it_asks() {
    for id in crate::engines::support::config::ENGINES {
        let engine = engine_by_id(id).unwrap();
        let offered = offered(engine.as_ref());
        assert!(!offered.is_empty(), "{id}");
        if offered.contains(&"ask") {
            assert_eq!(
                permission_for(engine.as_ref(), EngineMode::Ask),
                Ok("manual"),
                "{id}"
            );
        }
    }
}

#[test]
fn plan_without_a_reviewed_plan_mode_runs_as_ask() {
    let grok = engine_by_id("grok").unwrap();
    assert_eq!(
        permission_for(grok.as_ref(), EngineMode::Plan),
        Ok("manual")
    );
    let claude = engine_by_id("claude").unwrap();
    assert_eq!(
        permission_for(claude.as_ref(), EngineMode::Plan),
        Ok("plan")
    );
}
