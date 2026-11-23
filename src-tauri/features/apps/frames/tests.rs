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
    let token = register("bytes-test", "draw", "1.0.0", "window-1", false, None).unwrap();
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
    let token = register("doc-test", "draw", "1.0.0", "window-1", false, None).unwrap();
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
    assert!(accept("doc-test", None, &message(&token, "one", false)).is_none());
    assert!(accept("doc-test", None, &message("nope", "one", true)).is_none());
    assert!(matches!(
        accept("doc-test", None, &message(&token, "one", true)),
        Some((Accepted::Ready, _, _))
    ));
    assert!(matches!(
        accept("doc-test", None, &message(&token, "one", false)),
        Some((Accepted::Current, _, _))
    ));
    assert!(accept("doc-test", None, &message(&token, "two", true)).is_some());
    assert!(accept("doc-test", None, &message(&token, "one", false)).is_none());
    forget("doc-test");
}

#[test]
fn a_site_is_heard_only_from_its_own_address() {
    let address = FrameOrigin {
        scheme: "https".into(),
        host: "music.example.com".into(),
        port: None,
    };
    let token = register(
        "site-test",
        "tunes",
        "1.0.0",
        "window-1",
        true,
        Some(SiteGate {
            address: address.clone(),
            adapter: Some("1".into()),
        }),
    )
    .unwrap();
    let ready = PageMessage {
        token: token.clone(),
        doc: "one".into(),
        open: false,
        ready: true,
        frames: None,
        json: None,
        shortcut: None,
        focus: false,
    };
    let sign_in = FrameOrigin {
        scheme: "https".into(),
        host: "accounts.example.com".into(),
        port: None,
    };
    assert!(accept("site-test", None, &ready).is_none());
    assert!(accept("site-test", Some(&sign_in), &ready).is_none());
    let heard = accept("site-test", Some(&address), &ready).unwrap();
    assert_eq!(heard.2.as_deref(), Some("1"));
    forget("site-test");
}

#[test]
fn the_relay_carries_its_token_and_limit() {
    let script = relay_script("abc", "[]", "() => null", false);
    assert!(script.contains("\"abc\""));
    assert!(script.contains(&MAX_FRAME_BYTES.to_string()));
    assert!(!script.contains("__MISTY_APP_") && !script.contains("__KIRI_HOST_SENDER__"));
}
