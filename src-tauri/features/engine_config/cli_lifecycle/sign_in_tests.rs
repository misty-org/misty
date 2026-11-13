use super::*;

#[test]
fn slash_logins_are_typed_after_the_screen_is_up() {
    let pi = sign_in_plan("pi", Some("anthropic"), false).unwrap();
    assert!(pi.args.is_empty());
    assert_eq!(pi.then_type.as_deref(), Some("/login anthropic"));
    let omp = sign_in_plan("omp", Some("openai-codex"), false).unwrap();
    assert_eq!(omp.args, ["auth-broker", "login", "openai-codex"]);
    assert_eq!(omp.then_type, None);
    assert_eq!(
        sign_in_plan("claude", None, false).unwrap().args,
        ["auth", "login"]
    );
    assert_eq!(
        sign_in_plan("kimi", None, false)
            .unwrap()
            .then_type
            .as_deref(),
        Some("/login")
    );
    assert_eq!(sign_in_plan("grok", None, true).unwrap().args, ["logout"]);
    assert_eq!(
        sign_in_plan("minimax", Some("global"), false).unwrap().args,
        ["login", "--region", "global"]
    );
    assert!(sign_in_plan("minimax", Some("eu"), false).is_err());
    assert_eq!(sign_in_plan("agy", None, false).unwrap().args[0], "--print");
    assert_eq!(
        sign_in_plan("agy", None, true)
            .unwrap()
            .then_type
            .as_deref(),
        Some("/logout")
    );
}

#[test]
fn providers_are_plain_ids() {
    assert!(sign_in_plan("pi", Some("x; rm -rf ~"), false).is_err());
    assert!(sign_in_plan("pi", Some("Anthropic"), false).is_err());
}
