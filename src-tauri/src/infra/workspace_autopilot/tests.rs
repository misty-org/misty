use super::*;
#[test]
fn bounds_and_supported_input_are_enforced() {
    for action in [
        json!({"kind":"point","x":0.2,"y":0.6}),
        json!({"kind":"key","key":"SelectAll"}),
        json!({"kind":"type","text":"pilot"}),
    ] {
        assert!(validate_action(&action).is_ok());
    }
    for action in [
        json!({"kind":"point","x":2,"y":0.6}),
        json!({"kind":"key","key":"RunShell"}),
        json!({"kind":"scroll","x":0.5,"y":0.5,"deltaX":0,"deltaY":2001}),
    ] {
        assert!(validate_action(&action).is_err());
    }
}
