use super::*;

#[test]
fn a_type_step_needs_text() {
    let step = |value: Value| Step::from_value(&value).unwrap().validate();
    assert!(step(json!({"action": "type", "ref": "e12", "text": "pediatrician"})).is_ok());
    assert!(step(json!({"action": "type", "text": "into the focused field"})).is_ok());
    assert!(step(json!({"action": "type", "ref": "e12"})).is_err());
    assert!(step(json!({"action": "teleport", "ref": "e12"})).is_err());
}

#[test]
fn steps_are_checked_before_any_runs() {
    let ok = json!({"steps": [
        {"action": "click", "ref": "e3"},
        {"action": "fill", "ref": "e4", "text": "hello", "submit": true},
        {"action": "select", "ref": "e5", "values": ["Blue"]},
        {"action": "key", "key": "Enter"},
        {"action": "scroll", "direction": "down", "amount": 2.0},
        {"action": "wait_for", "text": "Saved", "timeoutMs": 5000},
        {"action": "scroll", "direction": "into_view", "text": "Class schedule"}
    ]});
    assert_eq!(parse_steps(&ok).unwrap().len(), 7);
    let replay = json!({"steps": [{"action": "click", "locator": {"role": "button", "name": "Save", "index": 1}}]});
    assert_eq!(
        parse_steps(&replay).unwrap()[0]
            .locator
            .as_ref()
            .unwrap()
            .index,
        Some(1)
    );
    for bad in [
        json!({"steps": []}),
        json!({"steps": [{"action": "click"}]}),
        json!({"steps": [{"action": "click", "ref": "button"}]}),
        json!({"steps": [{"action": "drag", "ref": "e1"}]}),
        json!({"steps": [{"action": "fill", "ref": "e1"}]}),
        json!({"steps": [{"action": "key", "key": "Hyper", "modifiers": ["Meta"]}]}),
        json!({"steps": [{"action": "drop", "ref": "e1"}]}),
        json!({"steps": [{"action": "drop", "ref": "e1", "url": "javascript:alert(1)"}]}),
        json!({"steps": [{"action": "drop", "text": "x"}]}),
        json!({"steps": [{"action": "scroll", "direction": "sideways"}]}),
        json!({"steps": [{"action": "scroll", "direction": "into_view"}]}),
        json!({"steps": [{"action": "wait_for", "timeoutMs": 50, "text": "x"}]}),
        json!({"steps": [{"action": "click", "ref": "e1", "clickCount": 3}]}),
        json!({"steps": [{"action": "click", "ref": "e1", "script": "alert(1)"}]}),
        json!({"steps": [{"action": "click", "ref": "e1", "locator": {"role": "button", "name": "Save"}}]}),
        json!({"steps": [{"action": "click", "locator": {"role": "", "name": "Save"}}]}),
        json!({"steps": (0..11).map(|_| json!({"action": "key", "key": "Tab"})).collect::<Vec<_>>()}),
    ] {
        assert!(parse_steps(&bad).is_err(), "{bad}");
    }
}

#[test]
fn form_fields_become_fill_select_and_check_steps() {
    let steps = form_steps(&json!({"fields": [
        {"ref": "e1", "value": "Ada"},
        {"ref": "e2", "value": true},
        {"ref": "e3", "value": false},
        {"ref": "e4", "value": ["Large"]},
        {"ref": "e5", "value": 42}
    ]}))
    .unwrap();
    let actions: Vec<_> = steps.iter().map(|step| step.action.as_str()).collect();
    assert_eq!(actions, ["fill", "check", "uncheck", "select", "fill"]);
    assert_eq!(steps[4].text.as_deref(), Some("42"));
    assert!(form_steps(&json!({"fields": [{"ref": "e1", "value": null}]})).is_err());
    assert!(form_steps(&json!({"fields": [{"value": "x"}]})).is_err());
    assert!(form_steps(&json!({"fields": []})).is_err());
}

#[test]
fn page_shortcuts_parse_and_window_ones_stay_off_native_input() {
    for chord in [
        ("s", vec!["Meta"]),
        ("Enter", vec!["Meta"]),
        ("b", vec!["Meta", "Shift"]),
        ("w", vec!["Meta"]),
    ] {
        let input = json!({"steps": [{"action": "key", "key": chord.0, "modifiers": chord.1}]});
        assert!(parse_steps(&input).is_ok(), "{input}");
    }
    let key =
        |key: &str, modifiers: &[&str]| json!({"kind": "key", "key": key, "modifiers": modifiers});
    assert!(crate::native::window_shortcut(&key("w", &["Meta"])));
    assert!(crate::native::window_shortcut(&key("Enter", &["Meta"])));
    assert!(!crate::native::window_shortcut(&key("a", &["Meta"])));
    assert!(!crate::native::window_shortcut(&key("Tab", &[])));
    assert!(!crate::native::window_shortcut(&key("Hyper", &["Meta"])));
    let drop = parse_steps(
        &json!({"steps": [{"action": "drop", "ref": "e2", "url": "https://example.com"}]}),
    )
    .unwrap();
    assert_eq!(drop[0].url.as_deref(), Some("https://example.com"));
}
