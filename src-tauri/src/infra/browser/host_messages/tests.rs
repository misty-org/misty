use super::*;

#[test]
fn background_messages_accept_only_bounded_hex_colors() {
    assert!(background_message(r##"{"token":"test","background":"#202124"}"##).is_some());
    for raw in [
        r##"{"background":"#202124"}"##,
        r##"{"token":"test","background":"#20212400"}"##,
        r##"{"token":"test","background":"red"}"##,
        r##"{"token":"test","background":"#gggggg"}"##,
        r##"{"token":"test","background":"#202124","extra":true}"##,
    ] {
        assert!(background_message(raw).is_none(), "{raw}");
    }
}

#[test]
fn navigate_messages_carry_only_host_navigations() {
    assert!(navigate_message(r#"{"navigate":"misty-shortcut:event?key=w&token=t"}"#).is_some());
    assert!(
        navigate_message(r#"{"navigate":"misty-context-menu:open?token=t&payload=%7B%7D"}"#)
            .is_some()
    );
    for raw in [
        r#"{"navigate":"misty-companion:submit?token=t&prompt=hi"}"#,
        r#"{"navigate":"https://example.com/"}"#,
        r#"{"navigate":"misty-shortcut:event","token":"t"}"#,
        r#"{"navigate":7}"#,
    ] {
        assert!(navigate_message(raw).is_none(), "{raw}");
    }
}

#[test]
fn pointer_messages_require_bounded_coordinates_and_a_token() {
    assert!(
        pointer_message(r#"{"token":"test","pointer":{"x":12.5,"y":40,"inside":true}}"#).is_some()
    );
    assert!(
        pointer_message(r#"{"token":"test","pointer":{"x":0,"y":0,"inside":false}}"#).is_some()
    );
    for raw in [
        r#"{"pointer":{"x":0,"y":0,"inside":true}}"#,
        r#"{"token":"test","pointer":{"x":-1,"y":0,"inside":true}}"#,
        r#"{"token":"test","pointer":{"x":100001,"y":0,"inside":true}}"#,
        r#"{"token":"test","pointer":{"x":0,"y":null,"inside":true}}"#,
    ] {
        assert!(pointer_message(raw).is_none(), "{raw}");
    }
}

#[test]
fn status_messages_name_a_known_change_and_carry_a_token() {
    assert!(status_message(r#"{"token":"test","status":"stopped"}"#).is_some());
    for raw in [
        r#"{"status":"stopped"}"#,
        r#"{"token":"test","status":"reloaded"}"#,
        r#"{"token":"test","status":"stopped","extra":1}"#,
    ] {
        assert!(status_message(raw).is_none(), "{raw}");
    }
}
