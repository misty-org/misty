//! Runner core tests: the permission bridge, lease accounting, the mirror and
//! the rule that routed work never passes a tool's bypass flags.
use std::path::PathBuf;

use serde_json::json;

use super::{
    bridge::{classify_command, decide, inside, BridgeContext, Decision},
    events::{ActionKind, PermissionRequest, RunnerEvent, TodoItem, Usage},
    lease::{Lease, LeaseMeter},
    mirror::Mirror,
    registry, runner_for, EngineId, Launch, LaunchMode, BYPASS_MARKERS,
};

fn request(kind: ActionKind, path: Option<&str>) -> PermissionRequest {
    PermissionRequest {
        id: "r1".into(),
        tool: "Edit".into(),
        kind,
        path: path.map(Into::into),
        command: None,
        input: json!({}),
    }
}

fn context(mode: &str) -> BridgeContext {
    BridgeContext {
        mode: mode.into(),
        plan: false,
        project_root: PathBuf::from("/work/app"),
        grants: vec![],
        lease_valid: true,
    }
}

#[test]
fn reads_continue_in_every_mode() {
    for mode in ["ask", "auto"] {
        assert_eq!(
            decide(
                &request(ActionKind::Read, Some("src/main.rs")),
                &context(mode)
            ),
            Decision::Allow
        );
    }
}

#[test]
fn ask_pauses_before_every_change_even_with_grants() {
    let mut ask = context("ask");
    ask.grants = vec![
        "project.edit".into(),
        "project.install".into(),
        "git.push".into(),
    ];
    for kind in [
        ActionKind::Edit,
        ActionKind::Run,
        ActionKind::Install,
        ActionKind::Push,
        ActionKind::Other,
    ] {
        assert!(
            matches!(
                decide(&request(kind, None), &ask),
                Decision::AskPerson { .. }
            ),
            "{kind:?}"
        );
    }
}

#[test]
fn auto_continues_inside_the_project_and_on_remembered_grants() {
    let mut auto = context("auto");
    assert_eq!(
        decide(&request(ActionKind::Edit, Some("src/lib.rs")), &auto),
        Decision::Allow
    );
    assert_eq!(
        decide(&request(ActionKind::Run, None), &auto),
        Decision::Allow
    );
    assert_eq!(
        decide(&request(ActionKind::Push, None), &auto),
        Decision::AskPerson { action: "git.push" }
    );
    assert_eq!(
        decide(&request(ActionKind::Install, None), &auto),
        Decision::AskPerson {
            action: "project.install"
        }
    );
    assert!(matches!(
        decide(&request(ActionKind::Network, None), &auto),
        Decision::AskPerson { .. }
    ));
    auto.grants = vec!["git.push".into()];
    assert_eq!(
        decide(&request(ActionKind::Push, None), &auto),
        Decision::Allow
    );
}

#[test]
fn outside_the_project_is_refused_in_every_mode() {
    let mut auto = context("auto");
    auto.grants = vec!["project.edit".into()];
    for path in [
        "/etc/passwd",
        "../other/file",
        "src/../../escape",
        "/work/application/x",
    ] {
        assert!(
            matches!(
                decide(&request(ActionKind::Edit, Some(path)), &auto),
                Decision::Deny { .. }
            ),
            "{path}"
        );
        assert!(
            matches!(
                decide(&request(ActionKind::Read, Some(path)), &auto),
                Decision::Deny { .. }
            ),
            "{path}"
        );
    }
    assert!(inside(&PathBuf::from("/work/app"), "./src/../README.md"));
}

#[test]
fn plan_runs_and_missing_leases_fail_closed() {
    let mut plan = context("auto");
    plan.plan = true;
    assert!(matches!(
        decide(&request(ActionKind::Edit, Some("a.rs")), &plan),
        Decision::Deny { .. }
    ));
    assert_eq!(
        decide(&request(ActionKind::Read, Some("a.rs")), &plan),
        Decision::Allow
    );
    let mut spent = context("auto");
    spent.lease_valid = false;
    assert!(matches!(
        decide(&request(ActionKind::Edit, Some("a.rs")), &spent),
        Decision::Deny { .. }
    ));
}

#[test]
fn commands_are_classified_by_what_they_do() {
    assert_eq!(classify_command("git push origin main"), ActionKind::Push);
    assert_eq!(
        classify_command("cd web && npm install left-pad"),
        ActionKind::Install
    );
    assert_eq!(classify_command("cargo add serde"), ActionKind::Install);
    assert_eq!(
        classify_command("curl https://example.com"),
        ActionKind::Network
    );
    assert_eq!(classify_command("git status"), ActionKind::Read);
    assert_eq!(classify_command("rg TODO src"), ActionKind::Read);
    assert_eq!(classify_command("npm test"), ActionKind::Run);
    assert_eq!(classify_command(""), ActionKind::Other);
}

#[test]
fn a_lease_stops_the_next_turn_once_spent_or_expired() {
    let lease = Lease {
        invocation_id: "inv".into(),
        token_budget: 1_000,
        expires_at: 100,
        grant_version: 1,
        grants: vec![],
        signature: "s".into(),
    };
    let mut meter = LeaseMeter::new(lease.clone());
    assert!(meter.valid(10));
    assert!(meter.record(
        &Usage {
            input: 400,
            output: 100,
            ..Default::default()
        },
        10
    ));
    assert!(!meter.record(
        &Usage {
            input: 400,
            output: 100,
            cache_read: 50,
            ..Default::default()
        },
        10
    ));
    assert!(!meter.valid(10));
    meter.renew(lease);
    assert!(meter.valid(10));
    assert!(!meter.valid(100), "an expired lease is not valid");
    assert!(!LeaseMeter::default().valid(0), "no lease, no turn");
}

#[test]
fn the_mirror_merges_deltas_and_keeps_only_the_newest_todos() {
    let mut mirror = Mirror::default();
    mirror.push(RunnerEvent::Delta { text: "Hel".into() });
    mirror.push(RunnerEvent::Delta { text: "lo".into() });
    let todo = |status: &str| RunnerEvent::Todos {
        items: vec![TodoItem {
            id: "1".into(),
            title: "Edit".into(),
            status: status.into(),
        }],
    };
    mirror.push(todo("pending"));
    mirror.push(todo("in_progress"));
    let batch = mirror.drain();
    assert_eq!(batch.len(), 2);
    assert_eq!(
        batch[0].event,
        RunnerEvent::Delta {
            text: "Hello".into()
        }
    );
    assert_eq!(batch[1].event, todo("in_progress"));
    assert!(batch[0].seq < batch[1].seq);
    mirror.push(RunnerEvent::Message {
        text: "done".into(),
    });
    mirror.requeue(batch);
    let again = mirror.drain();
    assert_eq!(again.len(), 3);
    assert!(again.windows(2).all(|pair| pair[0].seq < pair[1].seq));
}

#[test]
fn the_registry_stops_a_run_once() {
    let mut stop = registry::register("run-registry", "claude", "/work/app").expect("registers");
    assert!(registry::register("run-registry", "claude", "/work/app").is_none());
    assert!(registry::stop("run-registry"));
    assert!(stop.try_recv().is_ok());
    assert!(!registry::stop("run-registry"));
}

#[test]
fn engine_ids_match_the_server() {
    for engine in EngineId::ALL {
        assert_eq!(EngineId::parse(engine.as_str()), Some(engine));
    }
    assert_eq!(EngineId::parse("qoder-cn"), Some(EngineId::QoderCn));
    assert_eq!(EngineId::parse("misty"), None);
}

#[test]
fn routed_work_never_passes_bypass_flags() {
    for engine in EngineId::ALL {
        let Some(runner) = runner_for(engine) else {
            continue;
        };
        for mode in [LaunchMode::Plan, LaunchMode::Ask, LaunchMode::AutoEdit] {
            let launch = Launch {
                project_root: PathBuf::from("/work/app"),
                task: "Fix the bug".into(),
                mode,
                model: None,
                session: None,
                grants: vec![],
            };
            let Ok(spec) = runner.build_command(&launch) else {
                continue;
            };
            let mut protocol = runner.protocol(&launch);
            let everything = [
                spec.args.join(" "),
                spec.env
                    .iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join(" "),
                protocol.initial_input().join("\n"),
            ]
            .join("\n");
            for marker in BYPASS_MARKERS {
                assert!(
                    !everything.contains(marker),
                    "{engine} {mode:?} passes {marker}"
                );
            }
            assert_eq!(
                spec.cwd,
                PathBuf::from("/work/app"),
                "{engine} runs in the project"
            );
        }
    }
}
