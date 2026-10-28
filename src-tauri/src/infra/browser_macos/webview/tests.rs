use super::safari_user_agent;

#[test]
fn safari_identity_uses_the_installed_release_without_accepting_header_injection() {
    let user_agent = safari_user_agent("26.5.2").unwrap();
    assert!(user_agent.contains("Version/26.5.2 Safari/605.1.15"));
    assert!(safari_user_agent("26.5.2\r\nUnsafe: yes").is_none());
}
