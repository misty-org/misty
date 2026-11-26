use super::plans::{provider_id, remembered_sign_in};
use super::*;

fn found(version: (u64, u64, u64)) -> Found {
    Found {
        version: Some(version),
        google_chosen: false,
    }
}

fn plan(engine: &str, provider: Option<&str>, sign_out: bool) -> Plan {
    sign_in_plan(engine, provider, sign_out, &Found::default()).unwrap()
}

#[test]
fn slash_logins_are_typed_after_the_screen_is_up() {
    assert_eq!(
        plan("kimi", None, false).then_type.as_deref(),
        Some("/login")
    );
    assert_eq!(
        plan("qwen", None, false).then_type.as_deref(),
        Some("/auth")
    );
    assert_eq!(plan("claude", None, false).args, ["auth", "login"]);
    assert_eq!(plan("grok", None, true).args, ["logout"]);
    assert_eq!(
        plan("minimax", Some("global"), false).args,
        ["login", "--region", "global"]
    );
    assert!(sign_in_plan("minimax", Some("eu"), false, &Found::default()).is_err());
    assert_eq!(plan("agy", None, false).args[0], "--print");
    assert_eq!(
        plan("agy", None, true).then_type.as_deref(),
        Some("/logout")
    );
}

#[test]
fn newer_clis_sign_in_with_a_command_that_opens_the_browser() {
    let kimi = |provider| sign_in_plan("kimi", provider, false, &found((2, 6, 0))).unwrap();
    assert_eq!(kimi(None).args, ["login"]);
    assert_eq!(kimi(Some("cn")).args, ["login", "--region", "mainland-cn"]);
    assert_eq!(kimi(Some("global")).asks, Asks::Nothing);
    assert!(sign_in_plan("kimi", Some("eu"), false, &found((2, 6, 0))).is_err());

    let qoder = sign_in_plan("qoder", None, false, &found((1, 1, 88))).unwrap();
    assert_eq!(
        (qoder.args, qoder.then_type),
        (vec!["login".to_string()], None)
    );
    let old = sign_in_plan("qoder", None, false, &found((0, 2, 13))).unwrap();
    assert_eq!(old.then_type.as_deref(), Some("/login"));
}

#[test]
fn a_provider_is_a_plain_id() {
    assert!(sign_in_plan("kimi", Some("x; rm -rf ~"), false, &Found::default()).is_err());
    assert!(provider_id(Some("Anthropic")).is_err());
    assert_eq!(provider_id(Some(" xai ")).unwrap(), Some("xai"));
}

#[test]
fn gemini_signs_in_with_google_once_its_settings_choose_it() {
    let chosen = Found {
        version: None,
        google_chosen: true,
    };
    let gemini = sign_in_plan("gemini", None, false, &chosen).unwrap();
    assert_eq!(gemini.args[0], "--prompt");
    assert_eq!(gemini.then_type.as_deref(), Some("y"));
    assert_eq!(gemini.asks, Asks::Nothing);
    assert_eq!(
        shown_command("gemini", &gemini),
        "gemini --prompt Reply with just: Signed in"
    );
    assert_eq!(
        plan("gemini", None, false).then_type.as_deref(),
        Some("/auth")
    );
}

#[test]
fn gemini_settings_get_only_the_sign_in_choice() {
    let chosen = |text: &str| match google_sign_in_choice(Some(text)) {
        GoogleChoice::Write(written) => {
            serde_json::from_str::<serde_json::Value>(&written).unwrap()
        }
        other => panic!("{other:?}"),
    };
    assert!(matches!(
        google_sign_in_choice(None),
        GoogleChoice::Write(_)
    ));
    let fresh = chosen("  ");
    assert_eq!(fresh["security"]["auth"]["selectedType"], "oauth-personal");
    let kept = chosen("{\n  \"ui\": { \"theme\": \"Dracula\" },\n  \"a\": 1\n}");
    assert_eq!(kept["ui"]["theme"], "Dracula");
    assert_eq!(kept["security"]["auth"]["selectedType"], "oauth-personal");
    assert_eq!(
        chosen("{}")["security"]["auth"]["selectedType"],
        "oauth-personal"
    );
    assert_eq!(
        google_sign_in_choice(Some(
            r#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#
        )),
        GoogleChoice::Chosen
    );
    for text in [
        r#"{"security":{"auth":{"selectedType":"gemini-api-key"}}}"#,
        r#"{"selectedAuthType":"vertex-ai"}"#,
        "{\n  // mine\n  \"a\": 1\n}",
        r#"{"security":{"folderTrust":{"enabled":true}}}"#,
        "[]",
    ] {
        assert_eq!(
            google_sign_in_choice(Some(text)),
            GoogleChoice::Leave,
            "{text}"
        );
    }
}

#[test]
fn engines_without_a_status_command_remember_a_sign_in() {
    for engine in ["agy", "hermes", "kimi", "minimax"] {
        assert!(remembers_sign_in(engine), "{engine}");
        assert!(remembered_sign_in(engine).is_some_and(|(signed_in, _)| signed_in.is_some()));
    }
    for engine in [
        "claude", "codex", "gemini", "qwen", "grok", "qoder", "qoder-cn",
    ] {
        assert!(!remembers_sign_in(engine), "{engine}");
    }
    for engine in ["claude", "codex", "gemini", "qwen"] {
        assert_eq!(remembered_sign_in(engine), None, "{engine}");
    }
}

#[test]
fn what_each_sign_in_asks_of_the_person() {
    let asked = |engine: &str, provider: Option<&str>, sign_out: bool| {
        plan(engine, provider, sign_out).asks
    };
    assert_eq!(asked("claude", None, false), Asks::Code);
    assert_eq!(asked("agy", None, false), Asks::Code);
    assert_eq!(asked("codex", None, false), Asks::Nothing);
    assert_eq!(asked("grok", None, false), Asks::Nothing);
    assert_eq!(asked("gemini", None, false), Asks::Menu);
    assert_eq!(asked("hermes", None, false), Asks::Menu);
    assert_eq!(asked("hermes", None, true), Asks::Nothing);
    assert_eq!(asked("claude", None, true), Asks::Nothing);
    assert_eq!(asked("agy", None, true), Asks::Menu);
    assert_eq!(serde_json::to_value(Asks::Code).unwrap(), "code");
}

#[test]
fn a_pasted_code_is_one_plain_line() {
    assert_eq!(pasted_code("  abc#DEF-123\n").unwrap(), "abc#DEF-123");
    assert!(pasted_code("   ").is_err());
    assert!(pasted_code("abc\ndef").is_err());
    assert!(pasted_code("abc\u{1b}[A").is_err());
    assert!(pasted_code("abc\u{3}").is_err());
    assert!(pasted_code(&"x".repeat(4096)).is_err());
    let error = pasted_code("secret\ncode").unwrap_err();
    assert!(!error.contains("secret"));
}

#[test]
fn a_code_is_typed_then_return_on_its_own() {
    struct Writes(Vec<Vec<u8>>, Vec<u8>);
    impl Write for Writes {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.1.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.0.push(std::mem::take(&mut self.1));
            Ok(())
        }
    }
    let mut writes = Writes(Vec::new(), Vec::new());
    send_code(&mut writes, "abc#123", Duration::ZERO).unwrap();
    assert_eq!(writes.0, [b"abc#123".to_vec(), b"\r".to_vec()]);
    assert!(writes.1.is_empty());
}
