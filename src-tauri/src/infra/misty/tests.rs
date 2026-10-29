use super::*;

#[test]
fn a_damaged_session_file_reads_as_signed_out() {
    let parsed: Option<StoredSession> = serde_json::from_slice(b"{ not json").ok();
    assert!(parsed.is_none());
    let stored = StoredSession {
        user: Some(CurrentUser {
            id: "a".into(),
            username: "a".into(),
            email: "a@example.test".into(),
        }),
    };
    let round: StoredSession =
        serde_json::from_slice(&serde_json::to_vec(&stored).unwrap()).unwrap();
    assert_eq!(round.user.unwrap().id, "a");
}

#[test]
fn a_session_saved_with_a_license_still_reads() {
    let earlier = br#"{"user":{"id":"a","username":"a","email":"a@example.test"},"license":{"tier":"pro"}}"#;
    let stored: StoredSession = serde_json::from_slice(earlier).unwrap();
    assert_eq!(stored.user.unwrap().id, "a");
}
