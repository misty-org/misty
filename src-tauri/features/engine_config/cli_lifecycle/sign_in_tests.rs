use super::plans::remembered_sign_in;
use super::*;

fn plan(engine: &str, sign_out: bool) -> Plan {
    sign_in_plan(engine, sign_out).unwrap()
}

#[test]
fn each_engine_signs_in_with_its_own_command() {
    assert_eq!(plan("claude", false).args, ["auth", "login"]);
    assert_eq!(plan("codex", true).args, ["logout"]);
    assert_eq!(plan("agy", false).args[0], "--print");
    assert_eq!(plan("agy", true).then_type.as_deref(), Some("/logout"));
    assert!(sign_in_plan("misty", false).is_err());
}

#[test]
fn engines_without_a_status_command_remember_a_sign_in() {
    assert!(remembers_sign_in("agy"));
    assert!(remembered_sign_in("agy").is_some_and(|(signed_in, _)| signed_in.is_some()));
    for engine in ["claude", "codex"] {
        assert!(!remembers_sign_in(engine), "{engine}");
        assert_eq!(remembered_sign_in(engine), None, "{engine}");
    }
}

#[test]
fn what_each_sign_in_asks_of_the_person() {
    let asked = |engine: &str, sign_out: bool| plan(engine, sign_out).asks;
    assert_eq!(asked("claude", false), Asks::Code);
    assert_eq!(asked("agy", false), Asks::Code);
    assert_eq!(asked("codex", false), Asks::Nothing);
    assert_eq!(asked("claude", true), Asks::Nothing);
    assert_eq!(asked("agy", true), Asks::Menu);
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
