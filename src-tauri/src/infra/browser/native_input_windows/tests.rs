use super::*;

#[test]
fn keys_map_to_us_layout_codes() {
    let enter = key("Enter").unwrap();
    assert_eq!((enter.virtual_key, enter.text.as_deref()), (13, Some("\r")));
    let upper = key("A").unwrap();
    assert_eq!((upper.code.as_str(), upper.virtual_key), ("KeyA", 65));
    let bang = key("!").unwrap();
    assert_eq!((bang.code.as_str(), bang.virtual_key), ("Digit1", 49));
    let quote = key("\"").unwrap();
    assert_eq!((quote.code.as_str(), quote.virtual_key), ("Quote", 222));
    assert!(key("é").is_none());
    assert!(key("Shell").is_none());
}

#[test]
fn shortcuts_run_editing_commands() {
    assert_eq!(editing_command("a", 2), Some("selectAll"));
    assert_eq!(editing_command("Z", 2), Some("undo"));
    assert_eq!(editing_command("z", 2 | 8), Some("redo"));
    assert_eq!(editing_command("c", 2), None);
    assert_eq!(modifier_bits(&json!(["Control", "Shift"])), 10);
}
