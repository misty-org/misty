use super::*;

#[test]
fn automation_reads_what_is_on_screen() {
    let automation = Automation::new().unwrap();
    // The taskbar or desktop is always somewhere; reading never acts.
    let found = automation
        .element_at(5, 5)
        .or_else(|| automation.element_at(400, 400));
    if let Some(element) = found {
        assert!(!element.role().is_empty());
        let _ = (element.bounds(), element.description(), element.pressable());
    }
}

#[test]
fn container_roles_are_not_targets() {
    for role in ["Window", "Pane", "MenuBar", "Other"] {
        assert!(!is_target_role(role));
    }
    assert!(is_target_role("Button") && is_target_role("Edit"));
}
