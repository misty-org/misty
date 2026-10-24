use super::token_matches;

#[test]
fn only_the_exact_token_opens_the_bridge() {
    let token = "a-random-token-of-24-chars";
    assert!(token_matches(token, token));
    for wrong in [
        "",
        "a-random-token-of-24-char",
        "a-random-token-of-24-charsX",
        "A-random-token-of-24-chars",
    ] {
        assert!(!token_matches(token, wrong), "{wrong:?} was accepted");
    }
}
