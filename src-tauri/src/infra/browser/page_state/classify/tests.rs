use super::*;

fn meta(kind: &str, name: &str, label: &str, autocomplete: &str) -> FieldMeta {
    FieldMeta {
        kind: kind.into(),
        name: name.into(),
        label: label.into(),
        autocomplete: autocomplete.into(),
        ..Default::default()
    }
}

#[test]
fn secrets_by_type_autocomplete_and_label() {
    assert_eq!(
        classify(&meta("password", "p", "", ""), false),
        Class::Secret
    );
    assert_eq!(
        classify(&meta("text", "n", "", "cc-number"), false),
        Class::Secret
    );
    assert_eq!(
        classify(&meta("text", "code", "", "one-time-code"), false),
        Class::Secret
    );
    for label in [
        "Account number",
        "Routing number",
        "IBAN",
        "SSN",
        "CVV",
        "PIN",
        "Tax ID",
        "Passport",
        "Security answer",
        "API key",
    ] {
        assert_eq!(
            classify(&meta("text", "", label, ""), false),
            Class::Secret,
            "{label}"
        );
    }
    // Short tokens only match whole words.
    assert_eq!(
        classify(&meta("text", "", "Shipping instructions", ""), false),
        Class::Normal
    );
    assert_eq!(
        classify(&meta("text", "", "Spinach quantity", ""), false),
        Class::Normal
    );
}

#[test]
fn sensitive_and_normal_fields() {
    assert_eq!(
        classify(&meta("date", "dob", "Date of birth", "bday"), false),
        Class::Sensitive
    );
    assert_eq!(
        classify(&meta("tel", "phone", "Phone", "tel"), false),
        Class::Sensitive
    );
    assert_eq!(
        classify(&meta("text", "addr", "Street address", ""), false),
        Class::Sensitive
    );
    assert_eq!(
        classify(&meta("text", "size", "Shirt size", ""), false),
        Class::Normal
    );
    assert_eq!(
        classify(&meta("text", "size", "Shirt size", ""), true),
        Class::Secret,
        "excluded site"
    );
}

#[test]
fn secret_shaped_values() {
    assert!(secret_shaped("4111 1111 1111 1111"));
    assert!(!secret_shaped("4111 1111 1111 1112"));
    assert!(secret_shaped("123-45-6789"));
    assert!(secret_shaped("GB82 WEST 1234 5698 7654 32"));
    assert!(!secret_shaped("Blue, size M"));
    assert!(!secret_shaped("12345"));
}
