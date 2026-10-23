use super::*;

#[test]
fn the_agent_cursor_follows_pointer_actions_only() {
    let viewport = json!({"width": 1000, "height": 500});
    let click = json!({"kind": "click", "x": 0.25, "y": 0.5});
    assert_eq!(cursor_target(&click), Some((0.25, 0.5)));
    assert!(cursor_script(&click, &viewport)
        .unwrap()
        .contains("move(250.0,250.0,{hold:true})"));
    let drag = json!({"kind": "drag", "fromX": 0.1, "fromY": 0.2, "toX": 0.9, "toY": 0.8});
    assert_eq!(cursor_target(&drag), Some((0.9, 0.8)));
    assert!(cursor_script(&drag, &viewport)
        .unwrap()
        .contains("move(100.0,100.0,"));
    for input in [
        json!({"kind": "type", "text": "hi"}),
        json!({"kind": "key", "key": "Enter"}),
    ] {
        assert_eq!(cursor_target(&input), None);
        assert_eq!(cursor_script(&input, &viewport), None);
    }
    assert_eq!(cursor_script(&click, &json!({})), None);
}
#[test]
fn input_bounds_and_key_names_are_enforced() {
    for input in [
        json!({"kind":"drag","fromX":0.1,"fromY":0.2,"toX":0.8,"toY":0.9}),
        json!({"kind":"key","key":"a","modifiers":["Meta"]}),
        json!({"kind":"click","x":0.5,"y":0.5,"clickCount":2}),
        json!({"kind":"type","text":"house"}),
    ] {
        assert!(validate(&input).is_ok());
    }
    // Control is the command key off macOS: the same limits apply.
    #[cfg(not(target_os = "macos"))]
    {
        assert!(validate(&json!({"kind":"key","key":"a","modifiers":["Control"]})).is_ok());
        assert!(validate(&json!({"kind":"key","key":"z","modifiers":["Control","Shift"]})).is_ok());
        for key in ["w", "l", "c", "v", "t", "n", "q"] {
            assert!(validate(&json!({"kind":"key","key":key,"modifiers":["Control"]})).is_err());
        }
    }
    for input in [
        json!({"kind":"drag","fromX":0.1,"fromY":0.2,"toX":1.1,"toY":0.9}),
        json!({"kind":"key","key":"Shell"}),
        json!({"kind":"key","key":"q","modifiers":["Meta"]}),
        json!({"kind":"key","key":"l","modifiers":["Meta"]}),
        json!({"kind":"key","key":"c","modifiers":["Meta"]}),
        json!({"kind":"key","key":"v","modifiers":["Meta"]}),
        json!({"kind":"key","key":"x","modifiers":["Meta"]}),
        json!({"kind":"key","key":"a","modifiers":["Unknown"]}),
        json!({"kind":"click","x":0.5,"y":0.5,"clickCount":3}),
        json!({"kind":"scroll","x":0.5,"y":0.5,"deltaX":0,"deltaY":2001}),
    ] {
        assert!(validate(&input).is_err());
    }
}
