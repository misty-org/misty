use super::*;

#[test]
fn history_url_keeps_only_web_pages_without_credentials() {
    assert_eq!(
        history_url("https://user:secret@example.com/path?q=1").as_deref(),
        Some("https://example.com/path?q=1")
    );
    assert_eq!(history_url("about:blank"), None);
    assert_eq!(history_url("misty://history"), None);
    assert_eq!(history_url("file:///etc/passwd"), None);
}

#[test]
fn like_pattern_escapes_wildcards() {
    assert_eq!(like_pattern("50%_off"), "%50\\%\\_off%");
}
