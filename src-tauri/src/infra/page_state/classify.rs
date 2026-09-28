//! Sensitivity classes for captured form fields. Classification uses field
//! metadata before any value leaves the page; value-shape checks run on the
//! values the page returned and drop matches without storing them.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Class {
    /// Never captured: no value exists anywhere outside the page.
    Secret,
    /// Captured and synced end-to-end encrypted; restored locally only and
    /// never sent to a model.
    Sensitive,
    /// May be sent to the model during an agent restore.
    Normal,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct FieldMeta {
    pub key: String,
    pub tag: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub id: String,
    pub autocomplete: String,
    pub label: String,
    pub placeholder: String,
}

const SECRET_AUTOCOMPLETE: &[&str] = &["cc-", "one-time-code", "new-password", "current-password"];
const SECRET_WORDS: &[&str] = &[
    "password", "passwd", "passcode", "pwd", "account number", "acct", "routing", "iban", "swift", "bic",
    "sort code", "ssn", "social security", "sin", "national id", "national insurance", "card number",
    "cardnumber", "credit card", "debit card", "cvv", "cvc", "csc", "security code", "expiry", "expiration",
    "exp date", "pin", "tax id", "taxid", "ein", "tin", "passport", "driver's license", "drivers license",
    "driver license", "licence number", "security question", "security answer", "secret", "api key",
    "apikey", "access token", "token", "otp", "2fa", "verification code",
];
const SENSITIVE_AUTOCOMPLETE: &[&str] = &["bday", "tel", "street-address", "address-line", "postal-code", "sex"];
const SENSITIVE_WORDS: &[&str] = &[
    "birth", "dob", "phone", "mobile", "address", "street", "zip", "postcode", "postal", "salary", "income",
    "wage", "medical", "diagnosis", "health", "insurance", "medication", "allergy", "gender", "religion",
    "ethnicity", "email",
];

fn words(meta: &FieldMeta) -> String {
    format!("{} {} {} {} {}", meta.name, meta.id, meta.label, meta.placeholder, meta.autocomplete)
        .to_lowercase()
        .replace(['_', '-'], " ")
}

fn contains_word(haystack: &str, needle: &str) -> bool {
    // Short tokens ("pin", "sin", "tin", "ein", "otp") must match whole words.
    if needle.len() <= 4 && !needle.contains(' ') {
        return haystack.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == needle);
    }
    haystack.contains(needle)
}

/// `excluded` means the site is on the user's do-not-capture list.
pub fn classify(meta: &FieldMeta, excluded: bool) -> Class {
    if excluded || meta.kind == "password" {
        return Class::Secret;
    }
    let autocomplete = meta.autocomplete.to_lowercase();
    if SECRET_AUTOCOMPLETE.iter().any(|p| autocomplete.split_whitespace().any(|t| t.starts_with(p))) {
        return Class::Secret;
    }
    let text = words(meta);
    if SECRET_WORDS.iter().any(|w| contains_word(&text, w)) {
        return Class::Secret;
    }
    if SENSITIVE_AUTOCOMPLETE.iter().any(|p| autocomplete.contains(p))
        || SENSITIVE_WORDS.iter().any(|w| contains_word(&text, w))
        || meta.kind == "email"
        || meta.kind == "tel"
        || meta.kind == "date"
    {
        return Class::Sensitive;
    }
    Class::Normal
}

fn luhn(digits: &[u32]) -> bool {
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, d)| if i % 2 == 1 { let x = d * 2; if x > 9 { x - 9 } else { x } } else { *d })
        .sum();
    sum % 10 == 0
}

/// Values that look like secrets regardless of their label.
pub fn secret_shaped(value: &str) -> bool {
    let compact: String = value.chars().filter(|c| !matches!(c, ' ' | '-' | '.')).collect();
    let digits: Vec<u32> = compact.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() == compact.len() {
        if (13..=19).contains(&digits.len()) && luhn(&digits) {
            return true; // payment card
        }
        // US SSN written with separators: 3-2-4.
        let groups: Vec<&str> = value.trim().split(['-', ' ']).collect();
        if groups.len() == 3 && groups.iter().map(|g| g.len()).eq([3, 2, 4]) && digits.len() == 9 {
            return true;
        }
    }
    // IBAN: two letters, two digits, 11-30 alphanumerics, valid mod-97.
    let upper = compact.to_ascii_uppercase();
    if (15..=34).contains(&upper.len())
        && upper.chars().take(2).all(|c| c.is_ascii_alphabetic())
        && upper.chars().skip(2).take(2).all(|c| c.is_ascii_digit())
        && upper.chars().all(|c| c.is_ascii_alphanumeric())
    {
        let rotated = format!("{}{}", &upper[4..], &upper[..4]);
        let mut remainder = 0u32;
        for c in rotated.chars() {
            let n = c.to_digit(36).unwrap_or(0);
            for d in n.to_string().chars() {
                remainder = (remainder * 10 + d.to_digit(10).unwrap_or(0)) % 97;
            }
        }
        if remainder == 1 {
            return true;
        }
    }
    false
}

/// Unclassified long free text is treated as sensitive.
pub fn long_free_text(value: &str) -> bool {
    value.len() > 2048
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(kind: &str, name: &str, label: &str, autocomplete: &str) -> FieldMeta {
        FieldMeta { kind: kind.into(), name: name.into(), label: label.into(), autocomplete: autocomplete.into(), ..Default::default() }
    }

    #[test]
    fn secrets_by_type_autocomplete_and_label() {
        assert_eq!(classify(&meta("password", "p", "", ""), false), Class::Secret);
        assert_eq!(classify(&meta("text", "n", "", "cc-number"), false), Class::Secret);
        assert_eq!(classify(&meta("text", "code", "", "one-time-code"), false), Class::Secret);
        for label in ["Account number", "Routing number", "IBAN", "SSN", "CVV", "PIN", "Tax ID", "Passport", "Security answer", "API key"] {
            assert_eq!(classify(&meta("text", "", label, ""), false), Class::Secret, "{label}");
        }
        // Short tokens only match whole words.
        assert_eq!(classify(&meta("text", "", "Shipping instructions", ""), false), Class::Normal);
        assert_eq!(classify(&meta("text", "", "Spinach quantity", ""), false), Class::Normal);
    }

    #[test]
    fn sensitive_and_normal_fields() {
        assert_eq!(classify(&meta("date", "dob", "Date of birth", "bday"), false), Class::Sensitive);
        assert_eq!(classify(&meta("tel", "phone", "Phone", "tel"), false), Class::Sensitive);
        assert_eq!(classify(&meta("text", "addr", "Street address", ""), false), Class::Sensitive);
        assert_eq!(classify(&meta("text", "size", "Shirt size", ""), false), Class::Normal);
        assert_eq!(classify(&meta("text", "size", "Shirt size", ""), true), Class::Secret, "excluded site");
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
}
