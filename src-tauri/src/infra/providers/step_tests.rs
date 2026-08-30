use super::*;

#[test]
fn provider_step_accepts_proxy_field_alias() {
    let step = parse_provider_config_step(
        r#"{
            "kind":"post_auth_config",
            "state":"state-1",
            "field":{"name":"drive_id","label":"Drive","required":true},
            "poll_after_ms":0
        }"#,
    )
    .unwrap();
    assert_eq!(step.kind, "post_auth_config");
    assert_eq!(step.state, "state-1");
    assert_eq!(step.option.unwrap().name, "drive_id");
    assert_eq!(step.poll_after_ms, 1000);
}

#[test]
fn provider_step_accepts_first_options_entry() {
    let step = parse_provider_config_step(
        r#"{"kind":"post_auth_config","options":[{"name":"scope","defaultValue":"drive"}]}"#,
    )
    .unwrap();
    assert_eq!(step.option.unwrap().name, "scope");
}
