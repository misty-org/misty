use super::native_accelerator;

#[test]
fn canonical_shortcut_keys_are_translated_for_muda() {
    assert_eq!(native_accelerator("Cmd+Plus"), "Cmd+Shift+Equal");
    assert_eq!(native_accelerator("Cmd+Grave"), "Cmd+Backquote");
    assert_eq!(
        native_accelerator("Cmd+Shift+RightBracket"),
        "Cmd+Shift+BracketRight"
    );
}
