use super::*;

#[test]
fn a_page_is_named_by_its_mount() {
    assert_eq!(label_of("tab-1_draw").unwrap(), "misty-app-tab-1_draw");
    assert!(label_of("../x").is_err());
    assert_eq!(mount_of("misty-app-tab-1"), Some("tab-1"));
    assert_eq!(mount_of("misty-browser-tab-1"), None);
    assert!(!is_app_page("misty-app-"));
}

#[test]
fn bytes_are_held_for_their_mount_and_taken_once() {
    let token = register("bytes-test", "draw", "1.0.0", "window-1").unwrap();
    assert!(serves("misty-app-bytes-test", Some("draw")));
    assert!(!serves("misty-app-bytes-test", Some("other")));
    assert!(runs("bytes-test", "draw", "1.0.0"));
    assert!(put_bytes("bytes-test", Some("wrong"), "a", vec![1]).is_err());
    put_bytes("bytes-test", Some(&token), "a", vec![1, 2, 3]).unwrap();
    assert_eq!(take_bytes("bytes-test", Some("wrong"), "a"), None);
    assert_eq!(
        take_bytes("bytes-test", Some(&token), "a"),
        Some(vec![1, 2, 3])
    );
    assert_eq!(take_bytes("bytes-test", Some(&token), "a"), None);
    assert!(put_bytes("bytes-test", None, "../a", vec![]).is_err());
    forget("bytes-test");
    assert!(put_bytes("bytes-test", None, "a", vec![]).is_err());
}

#[test]
fn only_the_current_document_with_the_token_is_heard() {
    let token = register("doc-test", "draw", "1.0.0", "window-1").unwrap();
    let message = |token: &str, doc: &str, ready: bool| PageMessage {
        token: token.into(),
        doc: doc.into(),
        open: false,
        ready,
        frames: None,
        json: None,
        shortcut: None,
        focus: false,
    };
    assert!(accept("doc-test", &message(&token, "one", false)).is_none());
    assert!(accept("doc-test", &message("nope", "one", true)).is_none());
    assert!(matches!(
        accept("doc-test", &message(&token, "one", true)),
        Some((Accepted::Ready, _))
    ));
    assert!(matches!(
        accept("doc-test", &message(&token, "one", false)),
        Some((Accepted::Current, _))
    ));
    assert!(accept("doc-test", &message(&token, "two", true)).is_some());
    assert!(accept("doc-test", &message(&token, "one", false)).is_none());
    forget("doc-test");
}

#[test]
fn the_relay_carries_its_token_and_limit() {
    let script = relay_script("abc", "[]", "() => null");
    assert!(script.contains("\"abc\""));
    assert!(script.contains(&MAX_FRAME_BYTES.to_string()));
    assert!(!script.contains("__MISTY_APP_") && !script.contains("__KIRI_HOST_SENDER__"));
}
