use super::*;
use crate::engines::modes::{offered, ModeKind};
use crate::engines::{engine_by_id, SendRequest};
use serde_json::json;

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

/// The launch level for an engine mode id, as a run body names it.
fn launch(engine: &dyn Engine, id: &str) -> Result<&'static str, String> {
    launch_for(
        engine,
        &json!({ "engine": { "id": engine.id() }, "engine_mode": id }),
    )
}

#[test]
fn only_a_no_asking_mode_passes_an_engines_skip_permissions_flag() {
    for id in crate::engines::support::config::ENGINES {
        let engine = engine_by_id(id).expect("known engine");
        for mode in offered(engine.as_ref()) {
            let level = launch(engine.as_ref(), mode.id).expect("an offered mode launches");
            assert_eq!(level, mode.launch, "{id} {}", mode.id);
            if mode.kind != ModeKind::NoAsking {
                assert_ne!(level, "bypass", "{id} {}", mode.id);
            }
            let Some(args) = argv(engine.as_ref(), level) else {
                continue;
            };
            let skipped = args.iter().any(|arg| SKIP_FLAGS.contains(&arg.as_str()));
            if mode.kind != ModeKind::NoAsking {
                assert!(!skipped, "{id} in {} passed a skip flag: {args:?}", mode.id);
            }
        }
    }
}

/// The engines with a folder sandbox of their own; no other engine may list a no-asking mode.
const FOLDER_SANDBOXED: &[&str] = &["claude", "gemini", "qwen"];

#[test]
fn only_an_engine_with_a_folder_sandbox_lists_a_no_asking_mode() {
    for id in crate::engines::support::config::ENGINES {
        let engine = engine_by_id(id).unwrap();
        let lists = engine
            .modes()
            .iter()
            .any(|mode| mode.kind == ModeKind::NoAsking);
        assert_eq!(lists, FOLDER_SANDBOXED.contains(&id), "{id}");
        let offers = offered(engine.as_ref())
            .iter()
            .any(|mode| mode.kind == ModeKind::NoAsking);
        assert_eq!(offers, lists && engine.folder_sandbox(), "{id}");
    }
    let claude = engine_by_id("claude").unwrap();
    assert_eq!(
        claude.folder_sandbox(),
        cfg!(target_os = "macos")
            || (cfg!(target_os = "linux")
                && which::which("bwrap").is_ok()
                && which::which("socat").is_ok())
    );
    for id in ["gemini", "qwen"] {
        let engine = engine_by_id(id).unwrap();
        assert_eq!(engine.folder_sandbox(), cfg!(target_os = "macos"), "{id}");
    }
}

#[test]
fn a_no_asking_mode_skips_asks_only_inside_the_engines_sandbox() {
    for (id, mode, flags) in [
        (
            "claude",
            "bypassPermissions",
            &["--dangerously-skip-permissions", "--settings"][..],
        ),
        ("gemini", "yolo", &["--yolo", "--sandbox"][..]),
        ("qwen", "yolo", &["--yolo", "--sandbox"][..]),
    ] {
        let engine = engine_by_id(id).unwrap();
        let Ok(level) = launch(engine.as_ref(), mode) else {
            assert!(!engine.folder_sandbox(), "{id}");
            continue;
        };
        let args = argv(engine.as_ref(), level).unwrap();
        for flag in flags {
            assert!(args.contains(&flag.to_string()), "{id}: {args:?}");
        }
    }
}

#[test]
fn a_mode_the_engine_does_not_list_is_refused() {
    let claude = engine_by_id("claude").unwrap();
    assert!(launch(claude.as_ref(), "yolo").is_err());
    assert!(launch(claude.as_ref(), "auto").is_err());
    let kimi = engine_by_id("kimi").unwrap();
    assert!(launch(kimi.as_ref(), "yolo").is_err());
    assert_eq!(launch(kimi.as_ref(), "plan"), Ok("plan"));
}

#[test]
fn an_old_request_maps_to_the_engines_closest_mode() {
    let claude = engine_by_id("claude").unwrap();
    let old = |body: serde_json::Value| launch_for(claude.as_ref(), &body);
    assert_eq!(old(json!({ "permission_mode": "ask" })), Ok("manual"));
    assert_eq!(old(json!({ "permission_mode": "auto" })), Ok("auto"));
    assert_eq!(
        old(
            json!({ "permission_mode": "auto", "collaboration_mode": "plan", "conversation_id": "c" })
        ),
        Ok("plan")
    );
    let bypass = old(json!({ "permission_mode": "bypass" }));
    assert_eq!(
        bypass,
        Ok(if claude.folder_sandbox() {
            "bypass"
        } else {
            "auto"
        })
    );
    // Kimi has no mode that works without asking: Auto falls to the one that asks.
    let kimi = engine_by_id("kimi").unwrap();
    assert_eq!(
        launch_for(kimi.as_ref(), &json!({ "permission_mode": "auto" })),
        Ok("manual")
    );
    // Antigravity can't ask: an old Ask takes its own default.
    let agy = engine_by_id("agy").unwrap();
    assert_eq!(
        launch_for(agy.as_ref(), &json!({ "permission_mode": "ask" })),
        Ok("auto")
    );
}

#[test]
fn every_engine_offers_a_mode_with_one_kind_each_label() {
    for id in crate::engines::support::config::ENGINES {
        let engine = engine_by_id(id).unwrap();
        let modes = offered(engine.as_ref());
        assert!(!modes.is_empty(), "{id}");
        for (index, mode) in modes.iter().enumerate() {
            assert!(!mode.label.is_empty() && !mode.id.is_empty(), "{id}");
            assert!(
                modes[..index]
                    .iter()
                    .all(|earlier| earlier.id != mode.id && earlier.launch != mode.launch),
                "{id}: {} repeats an id or launch level",
                mode.id
            );
            // Sentence case: only the first letter (or a whole acronym) is upper case.
            let rest: String = mode.label.chars().skip(1).collect();
            assert!(
                mode.label == mode.label.to_uppercase() || rest == rest.to_lowercase(),
                "{id}: {}",
                mode.label
            );
        }
        if matches!(
            engine.plan_approval(),
            crate::engines::PlanApproval::Unavailable { .. }
        ) {
            assert!(
                modes.iter().all(|mode| mode.kind != ModeKind::Plans),
                "{id} lists a plan mode it can't review"
            );
        }
    }
}

#[test]
fn claude_bypass_settings_hold_it_to_the_folder() {
    let claude = engine_by_id("claude").unwrap();
    let Ok(level) = launch_for(
        claude.as_ref(),
        &json!({ "engine_mode": "bypassPermissions" }),
    ) else {
        return;
    };
    let mut req = request(level);
    req.additional_dirs = vec!["/data/shared".into()];
    let built = claude.build_command(&req, "claude").unwrap();
    let args: Vec<String> = built
        .command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let at = args.iter().position(|arg| arg == "--settings").unwrap();
    let settings: serde_json::Value = serde_json::from_str(&args[at + 1]).unwrap();
    assert_eq!(settings["sandbox"]["enabled"], true);
    assert_eq!(settings["sandbox"]["failIfUnavailable"], true);
    assert_eq!(settings["sandbox"]["allowUnsandboxedCommands"], false);
    assert_eq!(
        settings["sandbox"]["filesystem"]["allowWrite"],
        serde_json::json!(["/data/shared"])
    );
    assert_eq!(
        settings["permissions"]["blockWritesOutsideWorkingDirectories"],
        true
    );
    assert!(args.windows(2).any(|w| w == ["--add-dir", "/data/shared"]));
}
