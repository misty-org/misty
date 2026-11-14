use super::restore::with_checkpointing;
use super::*;

fn enabled(text: &str) -> Option<Value> {
    serde_json::from_str::<Value>(&files::strip_json_comments(text))
        .ok()?
        .pointer("/general/checkpointing/enabled")
        .cloned()
}

#[test]
fn checkpointing_is_written_into_the_text_as_it_is() {
    let fresh = with_checkpointing("").unwrap();
    assert_eq!(enabled(&fresh), Some(Value::Bool(true)));

    // A key at the top, with the person's order, layout and comments kept.
    let text =
        "{\n  // mine\n  \"ui\": { \"theme\": \"x\" },\n  \"model\": { \"name\": \"y\" }\n}\n";
    let written = with_checkpointing(text).unwrap();
    assert_eq!(enabled(&written), Some(Value::Bool(true)));
    assert!(written.contains("// mine") && written.find("\"ui\"") < written.find("\"model\""));

    // Inside an existing `general`, and replacing a `false`.
    let text = "{ \"general\": { \"vimMode\": true }, \"z\": [1, {\"a\": \"}\"}] }";
    assert_eq!(
        enabled(&with_checkpointing(text).unwrap()),
        Some(Value::Bool(true))
    );
    let text = "{ \"general\": { \"checkpointing\": { \"enabled\": false /* off */ } } }";
    let written = with_checkpointing(text).unwrap();
    assert_eq!(enabled(&written), Some(Value::Bool(true)));
    assert!(written.contains("/* off */"));

    // An empty object, and what can't be changed.
    assert_eq!(
        enabled(&with_checkpointing("{}").unwrap()),
        Some(Value::Bool(true))
    );
    assert!(with_checkpointing("{ \"general\": 3 }").is_none());
    assert!(with_checkpointing("[1]").is_none());
    assert!(with_checkpointing("{ broken").is_none());
}
