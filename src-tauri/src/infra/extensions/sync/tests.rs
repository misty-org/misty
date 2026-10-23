use super::*;
#[test]
fn sync_accepts_only_bounded_key_changes_and_explicit_tombstones() {
    assert!(safe_change("setting", &json!({"value":null})));
    assert!(safe_change("setting", &json!({"deleted":true})));
    for change in [
        json!({"deleted":false}),
        json!({"deleted":true,"value":1}),
        json!({}),
        json!(1),
        json!({"value":"x".repeat(8192)}),
    ] {
        assert!(!safe_change("setting", &change));
    }
}
#[test]
fn each_space_keeps_its_own_journal_and_readiness() {
    let personal = crate::infra::space_windows::PERSONAL;
    let space = "0123456789abcdef0123456789abcdef";
    // The personal Space keeps the journal written before Spaces.
    assert_eq!(journal_scope("account", personal), "account");
    assert_ne!(
        journal_scope("account", space),
        journal_scope("account", personal)
    );
    assert_ne!(
        readiness_key("account", space, "1"),
        readiness_key("account", personal, "1")
    );
}
