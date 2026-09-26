use std::path::PathBuf;

use serde_json::Value;

use super::{
    super::{
        events::ActionKind, events::PermissionRequest, EngineId, LaunchMode, RunnerError,
        BYPASS_MARKERS,
    },
    hosted_for,
    tests::launch,
};

#[test]
fn hosted_tools_never_bypass_their_permission_checks() {
    for engine in [EngineId::Opencode, EngineId::Dsh] {
        let runner = hosted_for(engine).expect("hosted");
        for mode in [LaunchMode::Plan, LaunchMode::Ask, LaunchMode::AutoEdit] {
            let launch = launch(mode, &[]);
            let Ok(spec) = runner.server(&launch, 4100) else {
                continue;
            };
            let mut protocol = runner.protocol(&launch);
            let request = PermissionRequest {
                id: "1".into(),
                tool: "bash".into(),
                kind: ActionKind::Run,
                path: None,
                command: None,
                input: Value::Null,
            };
            let calls: Vec<String> = protocol
                .start()
                .into_iter()
                .chain(protocol.answer(&request, true, ""))
                .map(|call| format!("{call:?}"))
                .collect();
            let everything = [
                spec.args.join(" "),
                format!("{:?}", spec.env),
                calls.join("\n"),
            ]
            .join("\n");
            for marker in BYPASS_MARKERS.iter().chain(&["\"always\""]) {
                assert!(
                    !everything.contains(marker),
                    "{engine} {mode:?} passes {marker}"
                );
            }
            assert_eq!(spec.cwd, PathBuf::from("/work/app"));
            assert!(
                spec.args.contains(&"127.0.0.1".to_owned()),
                "{engine} listens on loopback only"
            );
        }
    }
    let opencode = hosted_for(EngineId::Opencode).unwrap();
    let env = opencode
        .server(&launch(LaunchMode::Ask, &[]), 1)
        .unwrap()
        .env;
    assert!(
        env.iter()
            .any(|(key, value)| key == "OPENCODE_CONFIG_CONTENT"
                && value.contains("\"bash\":\"ask\""))
    );
    let dsh = hosted_for(EngineId::Dsh).unwrap();
    for mode in [LaunchMode::Plan, LaunchMode::Ask] {
        assert!(
            matches!(
                dsh.server(&launch(mode, &[]), 1),
                Err(RunnerError::Unsupported(_))
            ),
            "DeepSeek Shell runs only in Auto"
        );
    }
    let guarded = dsh
        .server(&launch(LaunchMode::AutoEdit, &[]), 1)
        .unwrap()
        .env;
    assert!(guarded
        .iter()
        .any(|(key, value)| key == "GIT_CONFIG_KEY_0" && value == "core.hooksPath"));
    assert!(dsh
        .server(&launch(LaunchMode::AutoEdit, &["git.push"]), 1)
        .unwrap()
        .env
        .is_empty());
}

#[test]
fn the_server_token_is_read_from_its_launch_line() {
    use super::server::token_in;
    assert_eq!(
        token_in("dsh web: http://127.0.0.1:3080/?token=Rm_F6-K9 ready").as_deref(),
        Some("Rm_F6-K9")
    );
    assert_eq!(token_in("listening on 127.0.0.1:3080"), None);
}
